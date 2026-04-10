import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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

# 프론트엔드 정적 파일 서빙 (안드로이드 앱 화면용)
app.mount("/", StaticFiles(directory="../frontend", html=True), name="static")

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
    future_labels = ["1~6h", "6~12h", "12~24h", "24~72h"]
    window_ranges = [(0, 6), (6, 12), (12, 24), (24, 72)]
    windows = []

    for name, (start, end) in zip(future_labels, window_ranges):
        # KMA(Best Match) 모델 기준 분석
        win_precip = precip_kma[current_idx + start + 1 : current_idx + end + 1]
        win_prob = prob_kma[current_idx + start + 1 : current_idx + end + 1]
        
        total_rain = sum([x if x is not None else 0 for x in win_precip])
        
        valid_probs = [x for x in win_prob if x is not None and x > 0]
        avg_prob = sum(valid_probs) / len(valid_probs) if valid_probs else 0
        
        status = "미대응"
        if avg_prob >= 80: status = "즉시 대응"
        elif avg_prob >= 60: status = "대응 준비"
        elif avg_prob >= 50: status = "예의 주시"
        
        windows.append({
            "name": name,
            "total_rain": round(total_rain, 1),
            "avg_prob": round(avg_prob),
            "status": status
        })

    # 최종 의사결정 (24~72h 기준)
    w24_72 = next((w for w in windows if w["name"] == "24~72h"), None)
    if not w24_72:
        decision = {"status": "미대응", "color": "#64748b", "target_window": None}
    else:
        color = "#64748b"
        if w24_72["status"] == "즉시 대응": color = "#ef4444"
        elif w24_72["status"] == "대응 준비": color = "#f97316"
        elif w24_72["status"] == "예의 주시": color = "#eab308"
        decision = {"status": w24_72["status"], "color": color, "target_window": w24_72}

    # 이유 생성
    tw = decision.get("target_window")
    if not tw:
        reason = "기상 데이터가 부족하여 종합 판단 구간(24~72시간)을 분석할 수 없습니다."
    elif decision["status"] == "미대응":
        reason = f"종합 판단 구간(24~72시간) 기준, 예상 누적 강수량은 {tw['total_rain']}mm, 강수 확률은 {tw['avg_prob']}%로 기준치(50%) 미만이므로 최종 미대응 상태입니다."
    else:
        reason = f"향후 결론 판단 구간(24~72시간) 내 예상 누적 강수량은 {tw['total_rain']}mm, 예측 강수확률 평균은 {tw['avg_prob']}%에 달하므로 최종 {decision['status']} 조치가 요구됩니다. (세부 상황 표 참조)"

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
