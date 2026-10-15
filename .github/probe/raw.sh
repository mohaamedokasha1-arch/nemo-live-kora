#!/usr/bin/env bash
set +e
export TODAY=$(TZ=Africa/Cairo date +%F) TOM=$(TZ=Africa/Cairo date -d tomorrow +%F) YEST=$(TZ=Africa/Cairo date -d yesterday +%F)
python3 - <<'PY'
import json, os, urllib.request, collections, re, urllib.parse
T=os.environ['TODAY']; M=os.environ['TOM']; Y=os.environ['YEST']
def get(u):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'nemo-live-kora-probe'}),timeout=25)
        return r.status, json.loads(r.read())
    except Exception as e:
        return getattr(e,'code',None), str(e)[:150]
S='https://sportscore.com'
for q in ['egypt','egyptian premier','caf champions','saudi','uae pro','qatar stars','premier league','world cup qualification','egypt cup','egyptian division']:
    s,j=get(f'{S}/api/v1/search/?sport=football&limit=8&q='+urllib.parse.quote(q))
    print('SEARCH',q,s,json.dumps(j,ensure_ascii=False)[:900])
for d,c in [(T,'saudi-professional-league'),(T,'uefa-europa-league'),(M,'caf-champions-league'),(M,'caf-confederation-cup'),(T,'egyptian-division-2'),(M,'egyptian-division-2'),(M,'spanish-la-liga'),(M,'laliga'),(M,'la-liga')]:
    s,j=get(f'{S}/api/v1/fixtures/?sport=football&limit=200&date={d}&competition={c}')
    ms=j.get('matches',[]) if isinstance(j,dict) else []
    print('COMP',d,c,s,len(ms),[(m['home'],m['away'],m['competition'],m['time']) for m in ms][:4])
for d in [Y,T,M]:
    for st in ['','&status=finished','&status=live','&status=upcoming']:
        s,j=get(f'{S}/api/v1/fixtures/?sport=football&limit=200&date={d}{st}')
        ms=j.get('matches',[]) if isinstance(j,dict) else []
        print('PART',d,st or 'all',s,len(ms), collections.Counter((m['status'],m.get('status_text')) for m in ms).most_common(8), ms[-1]['time'] if ms else None)
s,j=get(f'{S}/api/v1/fixtures/?sport=football&limit=200&date={T}')
eg=[m for m in j['matches'] if 'Egypt' in m['competition']]
print('EGY today',[(m['home'],m['away'],m['time'],m['status'],m['url']) for m in eg])
if eg:
    slug=eg[0]['url'].strip('/').split('/')
    print('slugparts',slug)
    for sl in [slug[2] if len(slug)>2 else '', '/'.join(slug[2:])]:
        s,d=get(f'{S}/api/widget/match/?sport=football&slug='+urllib.parse.quote(sl))
        print('DETAIL',sl,s,json.dumps(d,ensure_ascii=False)[:5000])
# a big match detail
s,j=get(f'{S}/api/v1/fixtures/?sport=football&limit=200&date={M}&status=upcoming')
for m in j.get('matches',[]):
    if 'CAF Champions' in m['competition']:
        print('CAFCL', m)
        sl=m['url'].strip('/').split('/')[2]
        s,d=get(f'{S}/api/widget/match/?sport=football&slug='+sl)
        print('DETAIL2',s,json.dumps(d,ensure_ascii=False)[:4000])
        break
PY
