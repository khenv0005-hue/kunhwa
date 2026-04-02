import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone, timedelta
import time
import math

app = FastAPI(title="Rain-Pollution Deployment Decision Support System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = {}
CACHE_TTL = 600

def get_current_kst_hour_prefix():
    # Use standard UTC datetime + 9h for Korea
    now = datetime.now(timezone.utc) + timedelta(hours=9)
    return now.strftime('%Y-%m-%dT%H:00')

@app.get("/api/v1/forecast")
async def get_forecast(lat: float, lon: float):
    # Latitude/longitude quantize to nearest 0.05 for cache
    lat_key = round(lat * 20) / 20.0
    lon_key = round(lon * 20) / 20.0
    cache_key = f"{lat_key}_{lon_key}"
    
    current_time = time.time()
    
    if cache_key in cache and current_time - cache[cache_key]['time'] < CACHE_TTL:
        data = cache[cache_key]['data']
    else:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&"
            f"hourly=precipitation&models=ecmwf_ifs04,gfs_seamless&"
            f"past_hours=24&forecast_hours=12&timezone=Asia%2FSeoul"
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
            cache[cache_key] = {'time': current_time, 'data': data}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"기상청(외부) API 연동 실패: {str(e)}")

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    
    precip_ecmwf = hourly.get("precipitation_ecmwf_ifs04", [])
    precip_gfs = hourly.get("precipitation_gfs_seamless", [])

    if not times:
        raise HTTPException(status_code=500, detail="데이터 파싱 오류")

    # Get index representing the "current hour"
    current_hour_str = get_current_kst_hour_prefix()
    try:
        current_idx = times.index(current_hour_str)
    except ValueError:
        # Fallback if time mismatch happens due to slightly off server time
        current_idx = 24

    # Extract Past data (Use ECMWF past analysis)
    # 24 hours behind the current index
    past_24_raw = precip_ecmwf[max(0, current_idx-24):current_idx]
    past_24 = [x if x is not None else 0 for x in past_24_raw]
    
    # Missing hours padded with 0
    if len(past_24) < 24:
        past_24 = [0] * (24 - len(past_24)) + past_24

    # Extract Future data (12 hours) (next hour + 12h)
    future_ecmwf_raw = precip_ecmwf[current_idx+1:current_idx+13]
    future_gfs_raw = precip_gfs[current_idx+1:current_idx+13]
    
    future_ecmwf = [x if x is not None else 0 for x in future_ecmwf_raw]
    future_gfs = [x if x is not None else 0 for x in future_gfs_raw]

    # Ensure length matches expected 12
    if len(future_ecmwf) < 12:
        future_ecmwf.extend([0] * (12 - len(future_ecmwf)))
    if len(future_gfs) < 12:
        future_gfs.extend([0] * (12 - len(future_gfs)))

    observed = {
        "1h": round(sum(past_24[-1:]), 1),
        "3h": round(sum(past_24[-3:]), 1),
        "6h": round(sum(past_24[-6:]), 1),
        "12h": round(sum(past_24[-12:]), 1),
        "24h": round(sum(past_24), 1),
    }

    # Calculate Agreement Score based on upcoming 12h absolute diff
    diffs = [abs(a - b) for a, b in zip(future_ecmwf, future_gfs)]
    avg_diff = sum(diffs) / 12
    agreement_score = max(0, 100 - int(avg_diff * 15))

    # --- DECISION LOGIC Engine ---
    score = 0
    reasons = []

    if observed["3h"] > 10:
        score += 25
        reasons.append(f"과거 3시간 유출 집중 ({observed['3h']}mm)")
    elif observed["24h"] > 20:
        score += 15
        reasons.append(f"과거 24시간 장벽 강수 ({observed['24h']}mm)")

    fut_3h_ecmwf = sum(future_ecmwf[:3])
    fut_3h_gfs = sum(future_gfs[:3])

    if fut_3h_ecmwf > 5 or fut_3h_gfs > 5:
        score += 25
        reasons.append("향후 3시간 단기 유출 강우 예측")
    
    if fut_3h_ecmwf > 2 and fut_3h_gfs > 2:
        score += 20
        reasons.append("신뢰도 높은 강수량(ECMWF/GFS일치)")
        
    radar_intensity = 0
    is_approaching = False
    if fut_3h_ecmwf > 1 or fut_3h_gfs > 1:
        is_approaching = True
        radar_intensity = int(max(fut_3h_ecmwf, fut_3h_gfs) * 10)
        score += 20
        reasons.append("레이더 구름망 반경 유입 중")

    if score >= 70:
        status = "출동 권고"
    elif score >= 50:
        status = "대기"
    else:
        status = "미출동"

    return {
        "lat": lat,
        "lon": lon,
        "observed": observed,
        "forecast": {
            "model_a": future_ecmwf,
            "model_b": future_gfs,
            "agreement": agreement_score
        },
        "radar": {
            "intensity": min(100, radar_intensity),
            "approaching": is_approaching
        },
        "decision": {
            "status": status,
            "score": score,
            "reasons": " + ".join(reasons) if reasons else "특이 강우 없음 (관망)",
            "confidence": agreement_score
        },
        "timestamp": current_time
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
