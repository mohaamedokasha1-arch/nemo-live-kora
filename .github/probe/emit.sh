#!/usr/bin/env bash
# emit.sh FILE OFFSET : prints up to 10 annotations of ~20KB from FILE starting at chunk OFFSET
python3 - "$1" "$2" <<'PY'
import sys
data=open(sys.argv[1],encoding='utf-8',errors='replace').read()
off=int(sys.argv[2]); size=20000
chunks=[data[i:i+size] for i in range(0,len(data),size)]
for i,c in enumerate(chunks[off:off+10]):
    c=c.replace('%','%25').replace('\r','').replace('\n','%0A')
    print(f"::notice title=chunk{off+i}::{c}")
PY
