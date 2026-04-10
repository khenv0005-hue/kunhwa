# -*- coding: utf-8 -*-
import os
import json
import glob
import geopandas as gpd

# Find the file using glob to avoid hardcoding korean string literal in python on windows
search_path = os.path.join("data", "*", "*_2024_12.shp")
files = glob.glob(search_path)
if not files:
    raise FileNotFoundError("Could not find the shapefile.")
shp_path = files[0]

out_path = "frontend/js/water_quality_stations.js"

print(f"Found shapefile: {shp_path}")
gdf = None

try:
    print("Trying utf-8 first...")
    gdf = gpd.read_file(shp_path, encoding='utf-8')
    first_name = str(gdf['ptNm'].iloc[0]).strip()
    if not first_name or "벑" in first_name or "쁺" in first_name or "" in first_name:
        raise ValueError("Corrupted utf-8 decoding")
    print(f"UTF-8 read successful. First ptNm: {first_name}")
except Exception as e:
    print(f"utf-8 try failed: {e}. Trying cp949...")
    gdf = gpd.read_file(shp_path, encoding='cp949')
    first_name = str(gdf['ptNm'].iloc[0]).strip()
    if not first_name or "벑" in first_name or "쁺" in first_name or "" in first_name:
        raise ValueError("Corrupted cp949 decoding too")
    print(f"CP949 read successful. First ptNm: {first_name}")

features = []
for idx, row in gdf.iterrows():
    if row.geometry is None: continue
    lon, lat = row.geometry.x, row.geometry.y
    
    ptNm = str(row['ptNm']) if 'ptNm' in gdf.columns else 'Unk'
    ptNo = str(row['ptNo']) if 'ptNo' in gdf.columns else 'Unk'
    stream_type = str(row['TYPE']) if 'TYPE' in gdf.columns else 'Unk'
    
    props = {
        'stn_cd': ptNo,
        'stn_nm': ptNm,
        'region': '전국',
        'watershed': '알수없음',
        'mid_region': '알수없음',
        'stream_type': stream_type,
        'sample_loc': '현장 확인 필요',
        'agency': '환경부',
        'install_yr': '2024'
    }
    
    features.append({
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': [lon, lat]
        },
        'properties': props
    })

geojson = {
    'type': 'FeatureCollection',
    'features': features
}

print(f"Writing {len(features)} stations to .js file...")
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('// =========================================================\n')
    f.write('// 환경부 수질측정망 데이터 (Shapefile에서 추출)\n')
    f.write('// =========================================================\n')
    f.write('const WQ_STATIONS_DATA = ')
    json.dump(geojson, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

print('Done.')
