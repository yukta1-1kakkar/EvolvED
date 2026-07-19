# EvolvED Three-Agent Architecture

EvolvED uses three model-backed agents. Learner-state construction, content indexing,
database persistence, guardrail checks, and API routing are deterministic services or
internal agent tasks. They are not presented as independent agents.

## 1. Personalised Instruction Agent

Purpose: create and deliver a source- and learner-aware teaching experience.

Inputs:

- learner profile and persistent learner state
- topic, selected roadmap stage, and prior adaptation
- pace and preferred modality
- lesson context and learner question for tutoring

Outputs:

- teaching strategy
- lesson roadmap
- lesson blueprint and modality-specific delivery
- lesson-grounded tutor response

Merged former responsibilities:

- learner modelling
- pedagogy selection
- lesson planning
- content generation and indexing
- roadmap generation
- interactive tutoring

The teaching strategy is derived inside this agent without a separate model request.
Normal lesson generation therefore requires one instruction-model request.

## 2. Assessment and Adaptation Agent

Purpose: measure learning and decide what should happen next.

Inputs:

- approved lesson and learning objectives
- assessment request or learner answers
- confidence and current mastery evidence

Outputs:

- lesson-grounded questions
- score, strengths, weaknesses, and misconceptions
- feedback and next-lesson adaptation

Merged former responsibilities:

- quiz generation
- assessment generation
- answer evaluation
- learner adaptation

Evaluation and adaptation are returned in the same model response. Assessment submission
therefore avoids a second sequential adaptation-model request.

## 3. Quality and Governance Agent

Purpose: convert module-leader sources into safe, accurate, review-ready material.

Inputs:

- extracted source text and source metadata
- requested lesson or assessment type
- candidate source-grounded draft
- quality, safety, and publishing contracts

Outputs:

- corrected lesson or assessment draft
- source-fidelity and quality status
- publish-ready content for module-leader approval

Merged former responsibilities:

- source analysis
- source-grounded draft generation
- quality review
- safety and publication readiness

Teacher approval and publication remain explicit human-controlled workflow steps rather
than autonomous agent decisions.

## Runtime flow

```text
Module leader source
        |
        v
Quality and Governance Agent
        |
        v
Module leader approval and publication
        |
        v
Personalised Instruction Agent
        |
        v
Assessment and Adaptation Agent
        |
        +---- adaptation evidence ----> next instruction cycle
```

## Research rationale

The architecture uses functional consolidation rather than one agent per cognitive task.
This reduces inter-agent hand-offs, repeated context serialization, sequential model
latency, failure points, and taxonomy ambiguity. It also preserves separation of concerns:
instruction, measurement/adaptation, and academic governance remain independently
explainable and testable.

The system should be described as three agents supported by deterministic services. A
database, embedding store, media renderer, guardrail function, API endpoint, or module
leader approval screen is a component or workflow, not an additional agent.
