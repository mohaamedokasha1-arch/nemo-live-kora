#!/usr/bin/env bash
set +e
export TODAY=$(TZ=Africa/Cairo date +%F) TOM=$(TZ=Africa/Cairo date -d tomorrow +%F)
python3 - <<'PY'
import json, os, urllib.request, collections, re
T=os.environ['TODAY']; M=os.environ['TOM']
def get(u, raw=False):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'nemo-live-kora-probe'}),timeout=25)
        b=r.read(); return r.status, (b.decode('utf-8','replace') if raw else json.loads(b))
    except Exception as e:
        return getattr(e,'code',None), str(e)[:200]
print('TODAY',T,'TOM',M)
for d in (T,M):
  for q in ['', '&page=2', '&offset=100', '&limit=500', '&per_page=500']:
    s,j=get(f'https://sportscore.com/api/v1/fixtures/?sport=football&date={d}&src=nemo-live-kora{q}')
    if isinstance(j,dict):
        ms=j.get('matches',[])
        print('SS fixtures',d,q,s,'count',j.get('count'),'len',len(ms),'keys',list(j.keys()),'first',ms[0]['home'] if ms else None,'last',ms[-1]['home'] if ms else None, 'times', ms[0]['time'] if ms else None, ms[-1]['time'] if ms else None)
    else: print('SS fixtures',d,q,s,j)
s,j=get(f'https://sportscore.com/api/v1/fixtures/?sport=football&date={T}&src=nemo-live-kora')
if isinstance(j,dict):
    ms=j['matches']; print('status values',collections.Counter(m.get('status') for m in ms)); print('extra keys',set(k for m in ms for k in m))
    print('comps',collections.Counter(m['competition'] for m in ms).most_common())
s,html=get('https://sportscore.com/developers/',raw=True)
if isinstance(html,str):
    txt=re.sub(r'<script.*?</script>|<style.*?</style>','',html,flags=re.S); txt=re.sub(r'<[^>]+>',' ',txt); txt=re.sub(r'\s+',' ',txt)
    print('DEVELOPERS PAGE',s,txt[:9000])
for d in (T,M):
    s,j=get(f'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d={d}&s=Soccer')
    ev=(j.get('events') or []) if isinstance(j,dict) else []
    print('TSDB day',d,s,len(ev),[(e['strLeague'],e['strEvent']) for e in ev][:10])
for lid in ['4829','4668','4806','4807','4328','4335']:
    s,j=get(f'https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id={lid}')
    ev=(j.get('events') or []) if isinstance(j,dict) else []
    print('TSDB next',lid,s,len(ev),[(e['strLeague'],e['strEvent'],e.get('strTimestamp'),e.get('intRound'),e.get('strSeason')) for e in ev][:3])
for L in ['egy.1','egy.2','egy.cup','ksa.1','uae.1','qat.1','caf.champions','caf.confed','eng.1','esp.1','ita.1','ger.1','fra.1','uefa.champions','fifa.worldq.afr','fifa.friendly']:
    for d in (T,M):
        s,j=get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{L}/scoreboard?dates={d.replace("-","")}')
        ev=j.get('events',[]) if isinstance(j,dict) else []
        print('ESPN',L,d,s,len(ev),[e.get('name') for e in ev][:5])
for path in [f'/api/matches?date={T}',f'/api/matches?date={M}']:
    s,j=get('https://nemo-live-kora.vercel.app'+path)
    if isinstance(j,dict):
        print('PROD',path,s,{k:(v if not isinstance(v,(list,dict)) else len(v)) for k,v in j.items()})
        ms=j.get('matches') or []
        print('  comps',collections.Counter(m.get('competitionNameEn') for m in ms).most_common(40))
    else: print('PROD',path,s,j)
s,j=get('https://nemo-live-kora.vercel.app/api/health')
print('HEALTH',s,json.dumps(j,ensure_ascii=False)[:3000] if isinstance(j,dict) else j)
PY
