# Implementation Plan: EvolvED Bedrock → Gemini Migration

## Context
EvolvED currently relies on AWS Bedrock (with Anthropic and Amazon Titan models) for AI operations. To adopt Google Gemini and maintain provider flexibility, we are implementing an abstraction layer. This will allow the platform to switch between AI providers via configuration, specifically enabling Google Gemini as the primary provider while retaining Bedrock support.

## Approach

### 1. Provider Abstraction
- Create a base `BaseLLMProvider` abstract class.
- Implement `GeminiProvider` and `BedrockProvider` inheriting from this base.
- Refactor existing `backend/app/ai/bedrock_client.py` into `BedrockProvider`.

### 2. Implementation Steps
1.  **Dependency Updates**: Add `google-generativeai` to `requirements.txt` and `pyproject.toml`.
2.  **Configuration**: Update `backend/app/core/config.py` to handle `GEMINI_API_KEY` and model mapping for Gemini.
3.  **Provider Layer**: Define the provider interface in `backend/app/ai/base_provider.py`.
4.  **Embeddings**: Implement Gemini embedding logic within `GeminiProvider`.
5.  **Refactoring**: Update `backend/app/ai/bedrock_client.py` to fit the new provider interface.
6.  **Integration**: Update `backend/app/api/routers.py` and any LangGraph nodes to use the provider factory instead of direct calls.

## Critical Files
- `backend/requirements.txt` / `backend/pyproject.toml`
- `backend/app/core/config.py`
- `backend/app/ai/base_provider.py` (New)
- `backend/app/ai/gemini_provider.py` (New)
- `backend/app/ai/bedrock_client.py` (Refactor to `BedrockProvider`)
- `backend/app/api/routers.py`

## Verification
- Validate `config.py` parsing of all new env vars.
- Test `GeminiProvider` with a direct invoke and embedding call.
- Run existing LangGraph workflows ensuring they now use the provider factory.
- Ensure speech synthesis (Polly) still functions via `BedrockProvider` if required.
