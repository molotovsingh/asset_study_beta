"""Polycab market-adjusted paths for leg 1 and leg 3. Usage: python -I result.py <yf.json>

Yahoo's ^CRSLDX series is missing two real NSE trading days in this window;
they are patched from NSE ind_close_all_DDMMYYYY.csv before aligning.
"""
import json, sys
y = json.load(open(sys.argv[1]))
s, b = y["POLYCAB.NS"]["close"], dict(y["^CRSLDX"]["close"])
b.update({"2024-01-01": 19469.5, "2024-02-19": 20241.1})  # NSE ind_close_all files
days = sorted(set(s) & set(b)); assert not (set(s) - set(b)), set(s) - set(b)

def path(t0, label):
    i0 = days.index(t0); e = i0 + 1; pre = days[i0 - 1]  # entry at close of first trading day after t0
    print(f"\n{label}: t0={t0}, entry close {days[e]} = {s[days[e]]:.2f}")
    print(f"  event day: stock {(s[t0]/s[pre]-1)*100:+.2f}%, N500 {(b[t0]/b[pre]-1)*100:+.2f}%, "
          f"market-adjusted {((s[t0]/s[pre])-(b[t0]/b[pre]))*100:+.2f} pts")
    for h in (1, 5, 10, 20, 60):
        j = e + h; rs = s[days[j]]/s[days[e]] - 1; rb = b[days[j]]/b[days[e]] - 1
        print(f"  hold {h:>2}d to {days[j]}: stock {rs*100:+7.2f}%  N500 {rb*100:+6.2f}%  market-adjusted {(rs-rb)*100:+7.2f} pts")

path("2023-12-22", "Leg 1 (search reported, intraday)")
path("2024-01-11", "Leg 3 (CBDT release after close 10 Jan)")
