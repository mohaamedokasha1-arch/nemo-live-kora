#!/usr/bin/env bash
set +e
export TODAY=$(TZ=Africa/Cairo date +%F) TOM=$(TZ=Africa/Cairo date -d tomorrow +%F)
python3 - <<'PY'
import json, os, urllib.request, collections, re
T=os.environ['TODAY']; M=os.environ['TOM']
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
def get(u, raw=False, ua='nemo-live-kora-probe'):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':ua,'Accept':'*/*'}),timeout=25)
        b=r.read(); return r.status, (b.decode('utf-8','replace') if raw else json.loads(b))
    except Exception as e:
        body=''
        try: body=e.read().decode()[:300]
        except Exception: pass
        return getattr(e,'code',None), (str(e)[:150]+' '+body)
B='https://sportscore.com/api/v1/fixtures/?sport=football&src=nemo-live-kora&date='
def summ(tag,u):
    s,j=get(u)
    if isinstance(j,dict):
        ms=j.get('matches',[])
        print(tag,s,'count',j.get('count'),'len',len(ms),'keys',list(j.keys()),'t0',ms[0]['time'] if ms else None,'tN',ms[-1]['time'] if ms else None, 'firstHome', ms[0]['home'] if ms else None)
        return ms
    print(tag,s,j); return []
for q in ['&limit=200','&limit=1000','&limit=200&offset=200','&limit=200&page=2','&limit=200&skip=200','&limit=200&start=200','&limit=200&cursor=200','&limit=200&from=200','&limit=200&status=upcoming','&limit=200&status=finished','&limit=200&status=live','&limit=200&order=desc','&limit=200&sort=-time','&limit=200&timezone=Africa/Cairo','&limit=200&tz=Africa/Cairo','&limit=200&time_from=15:00','&limit=200&after=2026-10-15T15:00:00Z','&limit=200&competition=egyptian-premier-league','&limit=200&competition_slug=saudi-professional-league','&limit=200&country=egypt']:
    summ('SS '+T+q, B+T+q)
ms=summ('SS tom 200',B+M+'&limit=200')
print('tom comps 200',collections.Counter(m['competition'] for m in ms).most_common())
ms=summ('SS today 200',B+T+'&limit=200')
print('today comps 200',collections.Counter(m['competition'] for m in ms).most_common())
print('status vals', collections.Counter((m['status'],m.get('status_text')) for m in ms))
for u in ['https://sportscore.com/developers/','https://sportscore.com/api/','https://sportscore.com/api/v1/','https://sportscore.com/api/docs/','https://sportscore.com/openapi.json','https://sportscore.com/api/v1/openapi.json','https://sportscore.com/robots.txt','https://sportscore.com/terms/','https://sportscore.com/llms.txt']:
    s,h=get(u,raw=True,ua=UA)
    if isinstance(h,str):
        t=re.sub(r'<script.*?</script>|<style.*?</style>','',h,flags=re.S); t=re.sub(r'<[^>]+>',' ',t); t=re.sub(r'\s+',' ',t)
        print('PAGE',u,s,t[:5000])
PY
