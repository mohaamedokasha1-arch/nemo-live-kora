#!/usr/bin/env bash
set +e
python3 - <<'PY'
import json, urllib.request, urllib.parse
def get(u):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'nemo-live-kora-probe'}),timeout=25)
        return r.status, json.loads(r.read())
    except Exception as e:
        return getattr(e,'code',None), str(e)[:150]
qs=['egyptian cup','egypt cup','egyptian league cup','egyptian super cup','egyptian second','egyptian third','caf super cup','saudi king','saudi arabia division 1','saudi super cup','adnoc','uae president','qatar emir','qatar cup','uefa champions','conference league','english premier','italian serie a','german bundesliga','bundesliga','french ligue 1','world cup qualification (caf)','world cup qualification (afc)','world cup qualification (uefa)','africa cup of nations','international friendly','afc champions league elite','afc champions league two','arab cup','algerian ligue professionnelle 1','botola','tunisian ligue','iraq stars','jordan premier','kuwait','oman professional','bahrain premier','libyan premier','sudan','lebanese premier','syrian premier','fifa world cup','club world cup','arab club champions','gulf cup','uefa nations league','copa libertadores','eredivisie','portuguese primeira','turkish super lig']
for q in qs:
    s,j=get('https://sportscore.com/api/v1/search/?sport=football&limit=10&q='+urllib.parse.quote(q))
    comps=j.get('competitions',[]) if isinstance(j,dict) else j
    print('Q',q,'=>',[(c['name'],c['slug'],c['url'].split('/')[3] if c.get('url') else '') for c in comps] if isinstance(comps,list) else comps)
PY
