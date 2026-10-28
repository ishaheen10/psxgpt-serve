psxGPT GEPA Optimization
========================

Purpose
-------
This folder defines how prompt/context optimization should work for the
psxGPT engine.

The optimization targets are not ad hoc strings in code. They are the real
context artifacts in:
- `apps/analysis/context/router/`
- `apps/analysis/context/lane/`
- `apps/analysis/context/compute/`
- `apps/analysis/context/analyst/`

The evaluator is not a toy function. It is the real engine exercised through
the stage test/eval runners.


Optimization Rule
-----------------
Do not optimize prompts without explicit golds.

Every optimization target must specify:
- target artifact(s)
- train gold set
- held-out eval set
- evaluator runner
- proposer/reflection/judge models
- acceptance rule

The gold contracts live in:
- `apps/analysis/spec.md` and the eval gold files under `eval/gold/`

The actual gold examples live in:
- `eval/gold/`


What GEPA Optimizes Here
------------------------
GEPA should optimize text parameters only:
- router context packs
- lane context packs
- compute instruction packs
- analyst prompt packs
- future skill/context fragments

It should not directly mutate:
- engine TypeScript logic
- deterministic model-build arithmetic
- SQL validation rules
- deterministic provenance code
- shaping code

If a failure is caused by deterministic code, fix code. If a failure is caused
by poor guidance or missing context, optimize the context artifact.


Stage Targets
-------------
Optimize in this order:

1. Router
   Targets:
   - `context/router/tables.md`
   - `context/router/rules.md`
   - `context/router/examples.md`
   Train/eval against Router golds only.

2. Structured lane
   Targets:
   - `context/lane/financial_statements.md`
   - `context/lane/market_data.md`
   - `context/lane/ratios.md`
   - `context/lane/management_comp.md`
   Train/eval against structured lane golds.

3. Narrative lane
   Targets:
   - `context/lane/financial_documents_new.md`
   Train/eval against narrative lane golds.

4. Analyst
   Targets:
   - `context/analyst/prompt.md`
   Train/eval against Analyst golds.

5. Compute guidance
   Targets:
   - `context/compute/instruction/model_build.md`
   Train/eval with deployed model-build evals when failures are caused by guidance, not TypeScript arithmetic.

6. Full pipeline
   Targets:
   - one frozen combination of the above
   Train/eval against full-pipeline golds.

Do not optimize the full pipeline first. That hides stage-specific failures.


Model Swapping
--------------
Model comparison belongs here, not in engine code.

For each optimization run, record:
- Router model
- Lane model
- Analyst model
- proposer model
- reflection/judge model

This lets us answer:
- did the prompt improve?
- or did a different model just mask the problem?

Changing models should be a run-config change, not a rewrite of the engine.


Expected Workflow
-----------------
1. Freeze the stage golds.
2. Run the stage test/eval baseline with current context files.
3. Optimize one stage's context files.
4. Compare against held-out eval golds.
5. Promote only if the new candidate improves the target stage and does not
   regress adjacent stages.
6. Update `spec.txt` or `tests.txt` if the run revealed a real missing rule.


Outputs
-------
GEPA runs should produce:
- candidate artifact diff
- train scores
- held-out eval scores
- diagnostic notes
- promoted/not promoted decision

Keep that output in GEPA-owned run folders or reports, not mixed into the
engine source tree.
