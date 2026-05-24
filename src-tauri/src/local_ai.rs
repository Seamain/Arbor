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

pub fn generate_commit_message(diff: &str, model_name: &str) -> Result<String, String> {
    let _backend = get_backend();

    let model_path = models_dir().join(model_name);
    if !model_path.exists() {
        return Err(format!(
            "Model not found: {}. Please download a GGUF model to {}",
            model_name,
            models_dir().display()
        ));
    }

    let model_params = LlamaModelParams::default();
    let model =
        LlamaModel::load_from_file(_backend, &model_path, &model_params).map_err(|e| {
            format!("Failed to load model: {}", e)
        })?;

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(std::num::NonZero::new(2048).unwrap()))
        .with_n_batch(512);

    let mut ctx = model.new_context(_backend, ctx_params).map_err(|e| {
        format!("Failed to create context: {}", e)
    })?;

    let prompt = format!(
        "<|system|>\nYou are a commit message generator. Based on the git diff, produce a single concise commit message following the Conventional Commits spec (type: short description). Reply with ONLY the commit message, no explanation.<|end|>\n<|user|>\nDiff:\n{diff}<|end|>\n<|assistant|>\n"
    );

    let tokens = model.str_to_token(&prompt, llama_cpp_2::model::AddBos::Never).map_err(|e| {
        format!("Failed to tokenize: {}", e)
    })?;

    let mut batch = LlamaBatch::new(512, 1);
    let last_index = (tokens.len() - 1) as i32;
    for (i, token) in tokens.iter().enumerate() {
        let is_last = i as i32 == last_index;
        batch.add(*token, i as i32, &[0], is_last).map_err(|e| {
            format!("Failed to add token: {}", e)
        })?;
    }

    ctx.decode(&mut batch).map_err(|e| {
        format!("Failed to decode: {}", e)
    })?;

    let mut sampler = LlamaSampler::chain_simple([
        llama_cpp_2::sampling::LlamaSampler::temp(0.3),
        llama_cpp_2::sampling::LlamaSampler::top_p(0.9, 1),
        llama_cpp_2::sampling::LlamaSampler::greedy(),
    ]);

    let mut output = String::new();
    let max_tokens = 120;

    for _ in 0..max_tokens {
        let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);

        if model.is_eog_token(new_token) {
            break;
        }

        let bytes = model.token_to_piece_bytes(new_token, 32, true, None).map_err(|e| {
            format!("Failed to convert token: {}", e)
        })?;
        let text = String::from_utf8_lossy(&bytes);
        output.push_str(&text);

        if output.contains('\n') {
            break;
        }

        batch.clear();
        batch.add(new_token, tokens.len() as i32, &[0], true).map_err(|e| {
            format!("Failed to add token: {}", e)
        })?;

        ctx.decode(&mut batch).map_err(|e| {
            format!("Failed to decode: {}", e)
        })?;
    }

    Ok(output.trim().to_string())
}
