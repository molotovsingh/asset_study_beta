from __future__ import annotations

OPTIONS_SCREENER_MAX_SYMBOLS = 25
OPTIONS_SCREENER_FETCH_CONCURRENCY = 3
OPTIONS_SIGNAL_VERSION = "options-signal-v1"

TRADE_IDEA_DEFINITIONS = [
    {
        "id": "long-calendar",
        "label": "Long Calendar",
    },
    {
        "id": "sell-vega",
        "label": "Sell Vega",
    },
    {
        "id": "buy-gamma-vega",
        "label": "Buy Gamma/Vega",
    },
    {
        "id": "short-calendar",
        "label": "Short Calendar",
    },
]

TRADE_VALIDATION_GROUP_DEFINITIONS = {
    "candidateBucket": "Candidate",
    "pricingBucket": "Pricing",
    "directionBucket": "Direction",
    "primaryTradeIdea": "Primary Trade Idea",
    "signalVersion": "Signal Version",
}

TRADE_VALIDATION_HORIZONS = {
    "1D": 1,
    "5D": 5,
    "10D": 10,
    "20D": 20,
    "EXPIRY": "expiry",
}

TRACKED_STRATEGY_BY_CANDIDATE_BUCKET = {
    "long-premium": "long_front_straddle",
    "short-premium": "short_front_straddle",
}

COLLECTOR_UNIVERSES = {
    "us-liquid-10": {
        "universeId": "us-liquid-10",
        "universeLabel": "US Liquid 10",
        "minimumDte": 25,
        "maxContracts": 4,
        "symbols": [
            "AAPL",
            "TSLA",
            "SPY",
            "QQQ",
            "NVDA",
            "MSFT",
            "AMZN",
            "META",
            "AMD",
            "NFLX",
        ],
    },
}
