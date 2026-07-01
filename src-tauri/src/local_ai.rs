use std::path::PathBuf;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use std::sync::OnceLock;

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();

fn get_backend() -> &'static LlamaBackend {
    BACKEND.get_or_init(|| LlamaBackend::init().expect("Failed to init llama backend"))
}

pub fn models_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("arbor")
        .join("models");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn list_local_models() -> Vec<String> {
    let dir = models_dir();
    std::fs::read_dir(&dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "gguf")
                        .unwrap_or(false)
                })
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

pub async fn download_model(url: &str, filename: &str) -> Result<String, String> {
    let dest = models_dir().join(filename);
    if dest.exists() {
        return Ok(format!("Model already exists: {}", dest.display()));
    }

    // Validate URL — only allow trusted model hosting domains to prevent SSRF.
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    let allowed_domains = [
        "huggingface.co",
        "hf-mirror.com",
        "github.com",
        "objects.githubusercontent.com",
    ];
    if !allowed_domains.iter().any(|d| host == *d || host.ends_with(&format!(".{}", d))) {
        return Err(format!(
            "Download domain '{}' is not allowed. Supported: {}",
            host,
            allowed_domains.join(", ")
        ));
    }

    // Validate filename — must end with .gguf and not contain path separators
    if !filename.ends_with(".gguf") || filename.contains('/') || filename.contains('\\') {
        return Err("Filename must be a .gguf file without path separators.".to_string());
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    std::fs::write(&dest, bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(format!("Downloaded to {}", dest.display()))
}

/// String-level stop sequences — covers all common chat-template end markers
/// across Qwen2.5, TinyLlama, Phi-3, Mistral, and similar GGUF models.
const STOP_SEQUENCES: &[&str] = &[
    "<|end|>",
    "<|endoftext|>",
    "<|im_end|>",
    "<|eot_id|>",   // Llama-3
    "</s>",
    "<|user|>",
    "<|assistant|>",
    "<|system|>",
];

pub fn generate_commit_message(diff: &str, model_name: &str, lang_instruction: &str) -> Result<String, String> {
    let backend = get_backend();

    let model_path = models_dir().join(model_name);
    if !model_path.exists() {
        return Err(format!(
            "Model not found: {}. Please download a GGUF model to {}",
            model_name,
            models_dir().display()
        ));
    }

    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(backend, &model_path, &model_params)
        .map_err(|e| format!("Failed to load model: {}", e))?;

    // Truncate diff to keep prompt short — small models (0.5B) get confused
    // when the diff is long and tend to regurgitate its content.
    let diff_limit = 3000usize;
    let truncated_diff: std::borrow::Cow<str> = if diff.len() > diff_limit {
        format!("{}\n... [truncated]", &diff[..diff_limit]).into()
    } else {
        diff.into()
    };

    // Build language-aware system message.
    // For non-English locales we repeat the language requirement in both
    // English and the target language so small models are more likely to comply.
    let (system_msg, user_prefix) = match lang_instruction.trim() {
        s if s.contains("Simplified Chinese") => (
            "你是一个提交信息生成器。\
             严格使用简体中文（Simplified Chinese）写提交信息。\
             遵循 Conventional Commits 规范：类型(范围): 简短描述。\
             只输出提交信息本身，一行，不要解释，不要代码块，不要引号。\
             示例：feat: 添加用户登录功能".to_string(),
            "请用简体中文为以下 diff 生成一条提交信息：",
        ),
        s if s.contains("Traditional Chinese") => (
            "你是一個提交訊息產生器。\
             必須使用繁體中文（Traditional Chinese）撰寫提交訊息，禁止使用簡體中文。\
             遵循 Conventional Commits 規範：類型(範圍): 簡短描述。\
             只輸出提交訊息本身，一行，不要解釋，不要程式碼區塊，不要引號。\
             範例：feat: 新增使用者登入功能".to_string(),
            "請用繁體中文為以下 diff 產生一條提交訊息：",
        ),
        _ => (
            "You are a commit message generator. \
             Write the commit message in English. \
             Follow the Conventional Commits spec: type(scope): description. \
             Reply with ONLY the commit message — one line, no explanation, no code blocks, no quotes. \
             Example: feat: add user login feature".to_string(),
            "Generate a commit message for the following diff:",
        ),
    };

    let prompt = format!(
        "<|im_start|>system\n{system_msg}<|im_end|>\n\
         <|im_start|>user\n{user_prefix}\n\n{truncated_diff}<|im_end|>\n\
         <|im_start|>assistant\n"
    );

    // Tokenize first so we know the exact token count
    let tokens = model
        .str_to_token(&prompt, llama_cpp_2::model::AddBos::Never)
        .map_err(|e| format!("Failed to tokenize: {}", e))?;

    if tokens.is_empty() {
        return Err("Prompt tokenized to zero tokens".into());
    }

    // n_ctx must fit the full prompt + generated tokens
    let n_ctx = (tokens.len() + 256).max(2048) as u32;
    // n_batch must be at least as large as the prompt so one decode call handles it all
    let n_batch = tokens.len().max(512) as u32;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(std::num::NonZero::new(n_ctx).unwrap()))
        .with_n_batch(n_batch);

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {}", e))?;

    // Fill the prompt batch — capacity = n_batch ≥ tokens.len(), so all adds succeed
    let mut batch = LlamaBatch::new(n_batch as usize, 1);
    let last_index = (tokens.len() - 1) as i32;
    for (i, &token) in tokens.iter().enumerate() {
        let is_last = i as i32 == last_index;
        batch
            .add(token, i as i32, &[0], is_last)
            .map_err(|e| format!("Failed to add token {i}: {}", e))?;
    }

    ctx.decode(&mut batch)
        .map_err(|e| format!("Failed to decode prompt: {}", e))?;

    let mut sampler = LlamaSampler::chain_simple([
        llama_cpp_2::sampling::LlamaSampler::temp(0.3),
        llama_cpp_2::sampling::LlamaSampler::top_p(0.9, 1),
        llama_cpp_2::sampling::LlamaSampler::greedy(),
    ]);

    // Accumulate raw bytes across tokens — Chinese/Japanese characters span
    // multiple bytes and may be split across token boundaries. Decoding each
    // token individually with from_utf8_lossy produces U+FFFD replacement
    // characters (garbage). We collect all bytes first, then decode once.
    let mut raw_bytes: Vec<u8> = Vec::new();
    let max_new_tokens = 150;
    let mut n_past = tokens.len() as i32;

    'gen: for _ in 0..max_new_tokens {
        let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);

        if model.is_eog_token(new_token) {
            break;
        }

        let piece = model
            .token_to_piece_bytes(new_token, 32, true, None)
            .map_err(|e| format!("Failed to convert token: {}", e))?;
        raw_bytes.extend_from_slice(&piece);

        // Decode what we have so far to check stop conditions.
        // Use lossy decoding only for stop-sequence scanning — the final
        // result is decoded from the complete byte buffer.
        let current = String::from_utf8_lossy(&raw_bytes);

        for stop in STOP_SEQUENCES {
            if current.contains(stop) {
                // Find the stop sequence byte offset and truncate
                if let Some(pos) = current.find(stop) {
                    raw_bytes.truncate(pos);
                }
                break 'gen;
            }
        }

        if current.contains('\n') && !current.trim().is_empty() {
            // Trim at the newline byte boundary
            if let Some(pos) = raw_bytes.iter().position(|&b| b == b'\n') {
                raw_bytes.truncate(pos);
            }
            break;
        }

        batch.clear();
        batch
            .add(new_token, n_past, &[0], true)
            .map_err(|e| format!("Failed to add generated token: {}", e))?;
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode generated token: {}", e))?;

        n_past += 1;
    }

    // Final UTF-8 decode of the complete byte buffer — no replacement chars
    let output = String::from_utf8(raw_bytes)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());

    Ok(output.trim().to_string())
}
