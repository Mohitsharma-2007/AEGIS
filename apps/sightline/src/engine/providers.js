export const QWEN_4B='qwen3-vl:4b-instruct-q4_K_M';
// URL routing is server-owned. This catalog describes what can be selected in the browser.
export const PROVIDERS={
  ollama:{name:'Ollama',group:'local',protocol:'ollama',model:QWEN_4B,hint:'Native runtime · no API key by default'},
  lmstudio:{name:'LM Studio',group:'local',protocol:'compatible',model:'',hint:'Local OpenAI-compatible server'},
  llamacpp:{name:'llama.cpp / llama-server',group:'local',protocol:'compatible',model:'',hint:'GGUF inference server · load a vision projector for images'},
  local:{name:'Custom local server',group:'local',protocol:'compatible',model:'',hint:'vLLM, LocalAI or any compatible server'},
  openai:{name:'OpenAI',group:'cloud',protocol:'compatible',model:'gpt-4.1-mini',hint:'Direct OpenAI API'},
  openrouter:{name:'OpenRouter',group:'cloud',protocol:'compatible',model:'qwen/qwen3-vl-8b-instruct',hint:'Use the model ID from OpenRouter'},
  gemini:{name:'Google Gemini',group:'cloud',protocol:'gemini',model:'gemini-2.5-flash',hint:'Native Gemini API'},
  anthropic:{name:'Anthropic',group:'cloud',protocol:'anthropic',model:'',hint:'Use a Claude model ID available on your API account'},
  groq:{name:'Groq',group:'cloud',protocol:'compatible',model:'',hint:'Use a vision model ID, or switch to Text + OCR'},
  together:{name:'Together AI',group:'cloud',protocol:'compatible',model:'',hint:'Use the model ID from Together AI'},
  dashscope:{name:'Alibaba Cloud Model Studio',group:'cloud',protocol:'compatible',model:'qwen-vl-plus',hint:'International (Singapore) compatible endpoint'},
  cloud:{name:'Custom cloud API',group:'cloud',protocol:'compatible',model:'',hint:'OpenAI-compatible API · server-configured base URL'},
};
export const isRuntime=(id)=>Object.hasOwn(PROVIDERS,id);
export const isLocalRuntime=(id)=>isRuntime(id)&&PROVIDERS[id].group==='local';
export const defaultRuntime={provider:'ollama',model:QWEN_4B,input:'vision',format:'auto',key:'',preferModel:false};
