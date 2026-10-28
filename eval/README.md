# Research evaluation

Run `pnpm --dir apps/analysis test` for source-boundary and lifecycle tests, and `pnpm --dir apps/analysis eval:research` for deployed replays. Private outputs go under ignored `outputs/research/`.

`legacy/` preserves old golden queries, eval scripts and optimization experiments as historical material. They target the retired router/lane contracts and are not runnable against the simplified engine. Restore checkpoint `1587411` to reproduce the old environment. Reuse relevant user questions as new research cases rather than restoring the old runtime contracts.
