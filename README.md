# george-gta6-twitch-forecast-20261119

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nezz11/george-gta6-twitch-forecast-20261119/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nezz11/george-gta6-twitch-forecast-20261119/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Offline hourly Twitch-viewer quantiles for a rolling console launch, learned from historical launch shapes and anchored to the observed first hour. The GTA forecast uses a corrected mixture of comparable launch curves with uncertainty calibrated on held-out console games.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

Historical practice observations come from the four public SullyGnome Average viewers charts identified in the competition NOTICE. The archive is keyed by game, launch date, observation cutoff and matching first-hour count. Its completed days are observed values; the future GTA VI case uses the dynamic forecast.

Data attribution: https://sullygnome.com . The MIT license applies to the implementation. Source URLs and collection time for historical factual counts are recorded in historical-launches.json.

