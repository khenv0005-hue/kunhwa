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
            f"hourly=precipitation,precipitation_probability&"
            f"models=best_match,ecmwf_ifs025,gfs_seamless,jma_seamless&"
            f"past_hours=24&forecast_days=4&timezone=Asia%2FSeoul"
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
    
    # 4개 모델 강수량 데이터
    precip_kma = hourly.get("precipitation_best_match", [])  # KMA 대응
    precip_ecmwf = hourly.get("precipitation_ecmwf_ifs025", [])
    precip_gfs = hourly.get("precipitation_gfs_seamless", [])
    precip_jma = hourly.get("precipitation_jma_seamless", [])

    # 4개 모델 강수확률 데이터
    prob_kma = hourly.get("precipitation_probability_best_match", [])
    prob_ecmwf = hourly.get("precipitation_probability_ecmwf_ifs025", [])
    prob_gfs = hourly.get("precipitation_probability_gfs_seamless", [])
    prob_jma = hourly.get("precipitation_probability_jma_seamless", [])

    if not times:
        raise HTTPException(status_code=500, detail="데이터 파싱 오류")

    current_hour_str = get_current_kst_hour_prefix()
    try:
        current_idx = times.index(current_hour_str)
    except ValueError:
        current_idx = 24

    # 과거 관측치 (최근 24시간)
    past_24_raw = precip_kma[max(0, current_idx-24):current_idx]
    past_24 = [x if x is not None else 0 for x in past_24_raw]
    observed = {
        "1h": round(sum(past_24[-1:]), 1) if past_24 else 0,
        "3h": round(sum(past_24[-3:]), 1) if past_24 else 0,
        "6h": round(sum(past_24[-6:]), 1) if past_24 else 0,
        "12h": round(sum(past_24[-12:]), 1) if past_24 else 0,
        "24h": round(sum(past_24), 1) if past_24 else 0,
    }

    # 미래 예측치 (72시간)
    future_labels = ["1~3h", "3~6h", "6~12h", "12~24h", "24~48h", "48~72h"]
    window_ranges = [(0, 3), (3, 6), (6, 12), (12, 24), (24, 48), (48, 72)]
    windows = []

    for name, (start, end) in zip(future_labels, window_ranges):
        # KMA(Best Match) 모델 기준 분석
        win_precip = precip_kma[current_idx + start + 1 : current_idx + end + 1]
        win_prob = prob_kma[current_idx + start + 1 : current_idx + end + 1]
        
        total_rain = sum([x if x is not None else 0 for x in win_precip])
        avg_prob = sum([x if x is not None else 0 for x in win_prob]) / len(win_prob) if win_prob else 0
        
        grade = "안전"
        if total_rain >= 30 or avg_prob >= 85: grade = "위험"
        elif total_rain >= 20 or avg_prob >= 70: grade = "경고"
        elif total_rain >= 10 or avg_prob >= 50: grade = "주의"
        
        windows.append({
            "name": name,
            "total_rain": round(total_rain, 1),
            "avg_prob": round(avg_prob),
            "grade": grade
        })

    # 최종 의사결정 (우선순위 역순)
    decision = {"status": "미대응", "color": "#64748b", "target_window": None}
    
    # 장기 검토
    for w in windows[4:]: # 24~48h, 48~72h
        if w["grade"] != "안전":
            decision = {"status": "장기 검토", "color": "#8b5cf6", "target_window": w}
    
    # 사전 계획
    if windows[3]["grade"] != "안전":
        decision = {"status": "사전 계획", "color": "#3b82f6", "target_window": windows[3]}
        
    # 예의주시
    if windows[2]["grade"] != "안전":
        decision = {"status": "예의주시", "color": "#eab308", "target_window": windows[2]}
        
    # 대응 준비
    if windows[1]["grade"] in ["위험", "경고"] or windows[0]["grade"] == "경고":
        decision = {"status": "대응 준비", "color": "#f97316", "target_window": windows[1]}
        
    # 즉시 대응
    if windows[0]["grade"] == "위험":
        decision = {"status": "즉시 대응", "color": "#ef4444", "target_window": windows[0]}

    # 이유 생성
    if decision["status"] == "미대응":
        reason = "모든 시간창에서 한국기상청(KMA) 예측 기준을 밑돌아 가장 안전한 <b>미대응</b> 상태로 진단되었습니다."
    else:
        tw = decision["target_window"]
        reason = f"향후 <b>{tw['name'].replace('h','시간')}</b> 내 한국기상청 기준 예측강수량이 <b>{tw['total_rain']}mm</b>, 강수확률이 <b>{tw['avg_prob']}%</b>로 <b>{tw['grade']}</b> 수준이므로 <b>{decision['status']}</b> 조치가 요구됩니다."

    return {
        "lat": lat,
        "lon": lon,
        "observed": observed,
        "windows": windows,
        "decision": {
            "status": decision["status"],
            "reason": reason,
            "color": decision["color"]
        },
        "forecast_compare": {
            "kma": precip_kma[current_idx+1:current_idx+73],
            "ecmwf": precip_ecmwf[current_idx+1:current_idx+73],
            "gfs": precip_gfs[current_idx+1:current_idx+73],
            "jma": precip_jma[current_idx+1:current_idx+73]
        },
        "timestamp": current_time
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
