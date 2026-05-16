# Moontower.ai, VRP, and Sinclair - Research Notes

_Research refresh: 2026-04-14_

This memo separates:

- public Moontower product facts
- public methodology and formula notes
- synthesis useful for `asset_study_beta`

Scope and caveats:

- I reviewed public Moontower pages, public Moontower blog posts and primer material, public Hull Tactical and Cboe posts, and a public Amberdata BTC options report.
- I did **not** inspect private or gated Moontower app internals beyond what is publicly visible.
- Where public materials use multiple renderings of the same idea, especially VRP, this memo calls that out explicitly instead of pretending there is one universal formula.

## 1. Executive summary

- Moontower is best understood as a **measurement and prospecting stack**, not a black-box signal engine.
- The public workflow is closer to:
  1. measure the surface
  2. rank what stands out
  3. drill down into why it stands out
  4. choose the trade expression
- `Trade Ideas` is a **daily cross-sectional ranking tool** built from four channels: IV percentile, VRP, RV percentile, and term-structure steepness.
- Public Moontower materials support **more than one VRP rendering**:
  - a log form for research/charting
  - simpler ratio or premium forms for tables and discussion
- Skew is a **separate premium family** from level vol. It should not be flattened into "just another VRP column."
- Scheduled events are a **first-order failure mode** for raw VRP.
- For `asset_study_beta`, the defensible path is:
  1. archive daily factor panels
  2. rank and filter
  3. add drill-down context
  4. backtest structures later

## 2. Moontower public product map

### 2.1 Public product surfaces

The public site names seven visible product surfaces:

| Surface | Public framing | Why it matters for this repo |
|---|---|---|
| Trade Ideas | Ranks long/short volatility setups from a multi-factor pattern | Model for candidate generation |
| Cockpit | Top-down snapshot of the market using options data | Model for market-state view |
| Dashboard | Cross-sectional view of cheap/rich volatility | Model for top-of-funnel screening |
| Position Visualizer | Structure visualization and P/L view | Useful later, after signal quality is good |
| Volatility Risk Premia | Scanner for richer option-selling opportunities | Direct precedent for VRP studies |
| Drill Down | Single-ticker detail view | Model for second-stage analysis |
| Pairs Analysis | Relative volatility comparison | Useful for relative-value studies |

### 2.2 Public primer workflow vs public product surfaces

One subtle but important distinction:

- the **homepage** presents product surfaces
- the **public primer** presents an analytic workflow

In Primer #8, the "top of the funnel" consists of four tools:

1. Dashboard
2. Real Vol
3. Skew
4. Vol Scanner

That is useful because it shows how Moontower thinks operationally:

- start with broad cross-sectional measurement
- inspect realized-vs-implied relationships
- inspect skew
- use a scanner for change and timing

### 2.3 Copilot, pricing, and public tools

At the time of review, the public site states:

- Moontower Copilot is updated daily on recent Moontower content
- options-data access for Copilot is "coming soon"
- public annual-billing prices are:
  - Starter: `$69/mo`
  - Pro: `$99/mo`
  - Enterprise: `$349/mo`

The public tools and simulators most relevant to this repo are not exhaustive, but they clearly cluster into useful categories:

- **Pricing / decomposition:** Option Pricing, Forward Volatility, Event Volatility Extractor, Volatility Converter, American Early Exercise, CRR Binomial Tree Lab
- **Hedging / ratio tools:** Implied Yield, Hedge Ratios, Options Pair Trade Hedge Ratio
- **Edge / intuition tools:** Trading Edge Statistical Calculator, Binary Straddle, Put-Call Parity Game, Gamma vs Theta Race
- **Simulation tools:** Leveraged ETF, Delta Hedging, Discrete Hedging, Calendar Spread

The implication is straightforward: Moontower is not only a screener. It is a measurement layer plus a calculator/simulator layer.

## 3. Metric surfaces and definitions

### 3.1 Dashboard = IV percentile vs steepness

The public primer defines Dashboard as:

- **X-axis:** 1-year percentile of 1-month IV
- **Y-axis:** steepness, using the ratio of 6-month IV to 1-month IV

Interpretation:

- it answers whether near-term IV is high or low versus its own history
- it answers whether the term structure is normal, flat, or inverted
- it naturally bins names into "buy/sell front vol" or "buy/sell back vol" buckets

This is a better mental starting point than asking "is this one option expensive?"

### 3.2 Real Vol = RV percentile vs log VRP

The public primer defines Real Vol as:

- **X-axis:** 1-year percentile of trailing 1-month realized vol
- **Y-axis:** `ln(1-month constant-maturity IV / 1-month realized vol)`

Interpretation:

- it answers whether the underlying has actually been moving a lot lately
- it shows whether IV is rich or discounted relative to that recent movement
- it highlights off-diagonal names where clustering or mean-reversion assumptions matter most

Important correction relative to earlier drafts:

- the public primer does **not** combine IV percentile, VRP, and steepness into one master chart
- Dashboard and Real Vol are separate top-of-funnel views

### 3.3 Skew = normalized wing premium to ATM

The public primer and later Moontower skew posts use normalized skew in a ratio form:

```text
normalized_skew = IV_OTM / IV_50d - 1
```

Common variants use:

- 25-delta put vs 50-delta
- 10-delta put vs 50-delta
- 25-delta call vs 50-delta
- 10-delta call vs 50-delta

Why this matters:

- it is easy to compare over time and across assets
- it is a relative measure of wing richness, not just an absolute vol-point difference
- it still needs context because normalized skew itself changes with the vol regime

### 3.4 Vol Scanner = change and timing layer

Vol Scanner is not a cheap/rich metric. It is a **change detector**:

- it compares IV changes across maturities and strikes
- it uses percent IV changes rather than raw "click" changes
- it can normalize across maturities with square-root-of-time logic

This makes it more useful as an execution or timing layer than as a top-of-funnel ranking metric.

### 3.5 Cross-sectional ranking changes the meaning of "high" and "low"

The public `Trade Ideas` post makes this explicit:

- the four channels are ranked across the chosen universe each day
- ranks are rescaled `1-100`

That means:

- "high VRP" means high **relative to today's universe**
- "low IV" means low **relative to today's universe**
- the same absolute reading can be "high" in one regime and ordinary in another

This point is easy to miss and central to how the app should be framed.

## 4. Trade Ideas and presets

The public `Trade Ideas` feature is best interpreted as **pattern matching**, not auto-trading.

Its four channels are:

1. IV Percentile
2. VRP
3. RV Percentile
4. Steepness

It then scores names by distance from preset target shapes.

### 4.1 Public presets, cleaned up

| Preset | Public pattern | Cleaner expression |
|---|---|---|
| Long Calendar | Low IV, high VRP, flatter/moderate term structure, RV can vary | Short front-month vol, long back-month vol |
| Sell Vega | High VRP with already-elevated RV and usually elevated vol | Net short premium / short vega candidate |
| Buy Gamma/Vega | Low VRP, low IV, low RV | Net long premium / long gamma-vega candidate |
| Short Calendar | High IV, low VRP, steep term structure | Long front-month vol, short back-month vol |

### 4.2 What this section is really saying

`Trade Ideas` does **not** tell us:

- this trade will make money
- this exact option structure is optimal
- every name inside a preset is equivalent

It tells us something narrower and more useful:

- several dimensions of the surface line up into a recognizable volatility expression

That is the right way to borrow from it.

## 5. VRP formulas, inputs, and failure modes

### 5.1 There is no single public VRP rendering

Public Moontower material supports at least two practical VRP renderings.

#### Research / chart form

```text
vrp_log = ln(IV / RV)
```

Some displays or notes may scale this for readability:

```text
display_vrp_log = 100 * ln(IV / RV)
```

This is useful for:

- charting
- z-score style comparisons
- avoiding asymmetry in the raw ratio

#### Table / shorthand form

```text
vrp_ratio = IV / RV
vrp_premium = IV / RV - 1
```

This is useful for:

- tables
- dashboard columns
- intuitive "premium / discount" discussion

#### Practical rule for our app

Use both if useful, but label them clearly:

- `vrp_log` for research and charting
- `vrp_ratio` for raw ratio
- `vrp_premium` for intuitive display

What we should **not** do is mix them interchangeably and call all of them "VRP" without showing the convention.

### 5.2 Public VRP inputs

The reviewed public Moontower material supports these inputs:

- **Numerator:** 1-month constant-maturity implied vol
- **Interpolation:** between the listed expiries bracketing roughly 30 calendar days
- **Method:** public explanations describe interpolation in `ln(time)` terms or equivalently variance interpolation
- **Denominator:** trailing realized vol from daily log returns, annualized

One public Moontower explanation explicitly uses:

```text
rv_1m = sample standard deviation of the last 20 daily log returns, annualized by sqrt(251)
```

Another public Moontower post refers to monthly RV using 21 trading days.

The right conclusion is not "which public page is wrong?" The right conclusion is:

- public material uses **roughly 20-21 trading days** as the 1-month RV window
- our app should pick a convention and label it explicitly

### 5.3 Important correction: zero-mean RV is optional, not the public default

An earlier draft stated that Moontower's VRP denominator drops the mean return (`mu = 0`) by default.

I could not verify that as the public default.

What the public materials clearly support:

- sample standard deviation of daily log returns is used in basic VRP explanations

What Moontower discusses elsewhere:

- zero-mean realized vol can be a useful alternate estimator in some contexts

Those are related, but not identical. For our app:

- zero-mean RV is a valid modeling choice
- it should be documented as an **alternate estimator**, not implied to be the canonical Moontower default

### 5.4 Why ratio or log ratio is better than simple difference for screening

A raw difference like `IV - RV` can still be useful for some intuitions, but it does a poor job normalizing across regimes.

Five vol points mean very different things at:

- 10 vol
- 60 vol

For cross-sectional screening and cross-asset comparison, these are usually cleaner:

- `IV / RV`
- `IV / RV - 1`
- `ln(IV / RV)`

### 5.5 Failure modes

The public Moontower material strongly supports these failure modes:

1. **Stale numerator (event ahead).** Upcoming earnings, FOMC, or another scheduled binary can inflate IV and make VRP look artificially rich.
2. **Stale denominator (event behind).** A recent large move can bloat trailing RV and make VRP look artificially low or negative.
3. **Numerator/denominator ambiguity.** A high or low VRP does not tell you whether IV moved, RV moved, or both.
4. **Sampling sensitivity.** Daily RV, point-to-point RV, and alternate estimators can tell different stories.
5. **Window overlap.** Exploratory rolling studies can look cleaner than reality because overlapping windows shrink effective sample size.

This is why Moontower repeatedly pairs VRP with:

- IV percentile
- RV percentile
- term structure
- event extraction / event awareness
- lagged IV or lagged VRP views

### 5.6 Lagged VRP matters more than static VRP for validation

Static VRP tells you what the market is paying **today** relative to recent realized movement.

Lagged VRP asks the more important research question:

- how did the implied vol do against the realized vol that actually unfolded next?

That is a much better validation layer than just saying "IV was above RV on the same date."

For this repo, lagged IV and lagged VRP should be explicit archived fields or derived studies, not hidden inside a loose backtest.

## 6. Term structure, forward vol, and skew

### 6.1 Steepness is not one thing

Public Moontower material expresses steepness in more than one practical way:

- `6M IV / 1M IV` in the primer Dashboard view
- premium or discount of M2 to M1 in simulator work
- qualitative "flat" vs "steep" in `Trade Ideas`

For our app, it is better to choose one canonical definition and expose alternates separately.

A defensible default would be:

```text
steepness_6m_1m = IV_6m / IV_1m
```

with an optional second helper:

```text
m2_premium_to_m1 = IV_m2 / IV_m1 - 1
```

### 6.2 Forward vol is often more trade-relevant than simple slope

Public Moontower calendar material pushes the user beyond "the back month is higher than the front month."

For calendar trades, what often matters more is:

- the forward vol implied between those dates

So a serious implementation should eventually track:

- level
- slope
- forward vol

not just one steepness column.

### 6.3 Skew is a different premium from VRP

VRP is about **level**:

- implied vol versus realized vol

Skew is about **shape**:

- how the wings trade relative to ATM

That means:

- a name can have cheap level vol but rich downside skew
- a name can have rich level vol but flat skew
- a name can have attractive VRP but awful wing pricing

Treating skew as "just another VRP column" would miss real structure.

## 7. Sinclair / Hull framing worth keeping

### 7.1 Structural story

The most useful Sinclair/Hull takeaway for this repo is structural:

- options are not only forecasting tools
- they are also insurance instruments
- repeated demand for downside protection can make puts rich
- repeated covered-call supply can make upside calls relatively cheap

That creates persistent patterns, but not effortless money.

### 7.2 Risk-reversal premium

The public Hull and Sinclair material gives a cleaner framework for skew than the earlier draft did:

- Hull treats the risk-reversal premium as distinct from the generic variance premium
- Sinclair's Cboe article frames the classic equity-index expression as **long call + short put**
- Hull also stresses that hedged RR P/L depends heavily on **spot/vol correlation**, not just realized skew

This matters for app design because it says:

- skew deserves its own metric family
- "sell the rich wing" is not enough
- sign conventions and hedge assumptions matter

### 7.3 Cross-asset caution: BTC can flip the sign

The Amberdata BTC report is useful precisely because it prevents lazy generalization.

Its sample suggests:

- simply **selling** the BTC risk-reversal delivered the best risk-adjusted returns among the RR variants they tested

That is the opposite sign from the standard equity-index "puts rich, calls cheap" intuition.

So:

- do not hard-code the sign of skew premium across asset classes
- equity indices, single names, and crypto can live in different skew regimes

### 7.4 The usable lesson

The valuable part of Sinclair-style framing is:

- a structural premium can be real
- the path to monetizing it can still be ugly
- regime, event context, and sizing matter more than the slogan

## 8. Expected value, expectancy, and sample size

### 8.1 Expected value (EV)

Property of a single bet under a specified model:

```text
EV = sum(probability x payoff)
```

### 8.2 Expectancy

Property of a repeated strategy or track record:

```text
Expectancy = (win rate x avg win) - (loss rate x avg loss)
```

### 8.3 Why hit rate is not enough

Win rate and expectancy are independent.

- A short-vol strategy can win often and still be fragile after tail losses.
- A long-convexity strategy can lose often and still have positive EV if the winners are large enough.
- A fairly priced long straddle can lose more often than it wins and still have near-zero EV.

### 8.4 Why this matters for VRP

If a premium exists on average, that tells us something about **average EV**.

It does **not** tell us:

- how noisy the realized path will be
- how many observations we need before expectancy separates from noise
- how much capital is sane to allocate

That is why Moontower's `Trading Edge Statistical Calculator` is relevant:

- it reframes "do I have edge?" as a sample-size and statistical-power question

## 9. Implications for `asset_study_beta`

This is the most important section for the repo.

### 9.1 The right product framing

The research pushes the app toward this stack:

1. **Measurement layer**  
   What is rich or cheap right now?
2. **Ranking layer**  
   Which names stand out versus today's universe?
3. **Drill-down layer**  
   Why do they stand out: IV, RV, term structure, skew, event, liquidity?
4. **Expression layer**  
   Which structure fits: short premium, long premium, long calendar, short calendar, RR, etc.?

That is much better than trying to jump from one raw VRP reading to a buy/sell label.

### 9.2 Minimum useful daily factor panel

For a serious v1, archive these fields per symbol per day:

| Field | Why it matters |
|---|---|
| `iv_30d_const` | Base near-term implied vol level |
| `rv_1m` | Base realized-vol denominator |
| `iv_pct_1y` | Historical context for IV |
| `rv_pct_1y` | Historical context for RV |
| `vrp_ratio` | Raw IV/RV comparison |
| `vrp_premium` | Human-readable premium / discount |
| `vrp_log` | Cleaner research / chart metric |
| `lagged_iv_vs_rv` | Whether prior implied beat ensuing realized |
| `lagged_vrp` | Better validation measure than static VRP |
| `steepness_6m_1m` | Term structure context |
| `forward_vol_*` | Better calendar context than slope alone |
| `normalized_put_skew_25d` | Downside wing richness |
| `normalized_call_skew_25d` | Upside wing richness |
| `rr_signed` | Signed skew / RR context |
| `event_flag` | Dirty vs clean surface |
| `spread_oi_volume_staleness` | Liquidity and data quality controls |

### 9.3 Validation should happen at two separate levels

Do not collapse these into one backtest.

#### Level 1: signal validation

- Did high VRP predict lower subsequent realized vol?
- Did low VRP predict higher subsequent realized vol?
- Did the implied move over- or under-shoot the realized absolute move?
- Did the signal behave differently in event-dirty vs event-clean names?

#### Level 2: structure validation

- Did the actual option structure make money after spreads, carry, roll-down, and exit assumptions?
- A good signal can still be a bad trade if the structure is wrong.
- A bad raw VRP read can still be a good trade if skew, term structure, or flow is favorable.

Most important warning:

- underlying forward return is **not** option P/L

### 9.4 Suggested build order

The clean build order is:

1. archive daily summary rows for IV, RV, VRP, steepness, skew, and liquidity
2. compute time-series percentiles and daily cross-sectional ranks
3. add event flags and "clean vs dirty" labeling
4. add lagged IV / lagged VRP validation studies
5. add drill-down views that explain why a name ranks highly
6. only then build structure-specific P/L backtests

### 9.5 What not to overclaim

This research argues against overclaiming these things:

- a high VRP number is **not** automatically a trade
- a monthly screener is **not** an options strategy engine by itself
- event-dirty names should not be compared blindly with event-clean names
- equity-index skew intuition should not be copied directly into crypto or single-name equities
- a signal and a trade expression are not the same object

## 10. Open questions still worth testing

- Will the app expose both `vrp_log` and `vrp_premium`, or only one?
- Should default RV use 20 trading days, 21 trading days, or multiple windows?
- Which exact steepness convention should the main UI standardize on?
- How should signed RR be defined and labeled by asset class?
- How should event cleaning work before we compare names cross-sectionally?
- Which minimum liquidity filters are required before ranks become trustworthy?

## 11. Selected public sources

### Moontower

- [Moontower home page](https://www.moontower.ai/)
- [Tools & Games](https://www.moontower.ai/tools-and-games)
- [Primer #8: Top of the Funnel: Cross-Sectional Fair Value](https://moontower.substack.com/p/primer-8-top-of-the-funnel-cross?ref=blog.moontower.ai)
- [Our newest feature: Trade Ideas](https://blog.moontower.ai/our-newest-feature-trade-ideas/)
- [The option market's point spread](https://blog.moontower.ai/the-option-markets-point-spread/)
- [Shorter VRP lookbacks](https://blog.moontower.ai/shorter-vrp-lookbacks/)
- [A Cockpit View Of Q3](https://blog.moontower.ai/a-cockpit-view-of-q3/)
- [Scatterplot Gallery](https://blog.moontower.ai/scatterplot-gallery/)
- [Breakpoints](https://blog.moontower.ai/breakpoints/)
- [How an option trader extracts earnings from a vol term structure](https://blog.moontower.ai/how-an-option-trader-extracts-earnings-from-a-vol-term-structure/)
- [Trading Edge Statistical Calculator](https://www.moontower.ai/tools-and-games/trading-edge-calculator)

### Sinclair / Hull / related

- [The Power of the Risk-Reversal (Cboe)](https://www.cboe.com/insights/posts/the-power-of-the-risk-reversal/)
- [The Risk-Reversal Premium (Hull Tactical)](https://www.hulltactical.com/2021/01/04/risk-reversal-premium/)
- [The Variance Risk Premium (Hull Tactical)](https://www.hulltactical.com/2024/12/05/the-variance-risk-premium/)

### Cross-asset / crypto context

- [BTC Options: Dissecting Volatility Trends (Amberdata PDF)](https://blog.amberdata.io/hubfs/Amberdata-BTCOptions.pdf)
