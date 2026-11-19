# Generate Fictional Casino Game Catalogue

You are generating a clean reference batch of **fictional** online casino games for a recommender system evaluation.

## Rules
1. Every game title and studio (`provider`) must be **fictional** (do not use real commercial slot titles or real studio names). Use the studio pool provided in the user prompt so multiple games share providers.
2. Make titles evocative and specific so a reader can infer the theme or mechanic from the title and description.
3. `description` must be 2-3 neutral, informative sentences describing the theme, reel/table setup, and core gameplay mechanics. Do not include RTP numbers or promotional hype in `description`.
4. Only use values from the allowed enums for `category`, `themes`, `mechanics`, `volatility`, and `brands`.
5. Choose 1-3 `themes` and 1-4 `mechanics` that genuinely fit the game.
6. Set `rtp` between `94.0` and `97.5` (one or two decimal places).
7. Set `releaseDate` as an ISO date `YYYY-MM-DD` between `2019-01-01` and `2025-12-31`.
8. Include 1-3 `brands` per game from `["northstar", "lucky-harbour", "redcrest"]`.
