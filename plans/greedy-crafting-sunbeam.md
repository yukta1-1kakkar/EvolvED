# Migration Plan: Bedrock to Gemini

## 1. Context
The EvolvED platform is migrating its primary AI provider from AWS Bedrock to Google Gemini to leverage newer models and potentially different performance characteristics while maintaining the existing LangGraph-based orchestration and SQLAlchemy/ChromaDB persistence layers.

## 2. Approach: Provider Abstraction Layer
Instead of hard-coding Gemini SDK calls in `app.ai`, we will implement a provider pattern.

- **Interface**: Define `LLMProvider` (Base Class) in `app.ai.base`.
- **Implementations**:
  - `BedrockProvider`: Inherits `LLMProvider`, encapsulates current `bedrock_client.py` logic.
  - `GeminiProvider`: Inherits `LLMProvider`, uses Google's Generative AI Python SDK.
- **Factory**: A central factory function (or dependency injection) will return the active provider based on environment configuration.

## 3. Scope of Work
- **Config**: Update `config.py` to support `ACTIVE_PROVIDER` and new Gemini-specific variables.
- **Abstraction**: Create `app/ai/provider.py` defining the interface.
- **Migration**: Refactor `app/ai/bedrock_client.py` to `app/ai/bedrock_provider.py` following the new interface. Implement `app/ai/gemini_provider.py`.
- **Embedding**: Replace `Titan` calls with Gemini embedding calls.
- **LangGraph**: Update nodes in `backend/app/core/langgraph_nodes.py` to use the injected provider instead of calling `bedrock_client` directly.

## 4. Dependencies
- Add `google-generativeai` to `requirements.txt`.
- Keep `boto3` but only for the Bedrock implementation.

## 5. Verification
- **Unit Tests**: Test provider implementations in isolation.
- **Integration**: Verify LangGraph agents correctly invoke Gemini with expected inputs/outputs.
- **TTS**: Polly remains the active TTS engine (as Bedrock client only provides text synthesis).
