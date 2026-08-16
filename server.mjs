import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_SCAN_MODEL || 'gpt-5.6';
const MAX_BODY = 18 * 1024 * 1024;

const mime = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'
};

const SCAN_PROMPT = `You are the STRICT SCANNER module inside CNC Copilot. Your only task is to read photos of CNC indexable-insert packaging and, when present, the insert itself. Do not recommend cutting parameters, do not chat, do not infer unsupported facts.

Return ONE JSON object only, no markdown. Read exact visible markings. If a value is not visible or cannot be inferred confidently, use an empty string, null, [] or {} rather than guessing.

Fields:
{
  "manufacturer": string,
  "insert": string,                  // exact insert designation, e.g. WNMG 080404-PM3, DCMT11T304-HW, MGMN300-MTL
  "grade": string,                   // exact grade, e.g. CT8225GC, PT9025, PT9225N
  "breaker": string,                 // chipbreaker suffix such as PM3/HW/MTL when visible
  "nose_radius_mm": number|null,
  "material_groups": ["P"|"M"|"K"|"N"|"S"|"H"],
  "iso_priority": {"P":"primary|secondary|off", "M":"primary|secondary|off", "K":"primary|secondary|off", "N":"primary|secondary|off", "S":"primary|secondary|off", "H":"primary|secondary|off"},
  "operations": ["face"|"od"|"bore"|"groove"|"part"|"thread_ext"|"thread_int"|"drill"],
  "holder_compatibility": string,
  "quantity": number|null,
  "confidence": number,              // 0..1 for the overall transcription
  "evidence": string,                // short Russian summary of what was actually visible
  "notes": string
}

Rules for ISO colored-dot panels: a solid/filled dot means primary, an open/outline dot means secondary, absence means off. If the package does not show a dot panel but explicitly says a material group in text, put that group in material_groups; leave unknown priority values out or off. Do not derive grade suitability from memory if it is not visible.

Operation mapping from visible insert geometry/packaging only: turning insert -> face/od; clearly internal finishing can include bore; MGMN/grooving insert -> groove and possibly part if packaging indicates parting; threading insert -> thread_ext or thread_int according to designation/packaging. If uncertain, keep operations minimal.

The user will confirm/edit the card before saving.`;

function send(res, code, body, type='application/json; charset=utf-8') {
  res.writeHead(code, {'Content-Type': type, 'Cache-Control':'no-store'});
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === 'string') out.push(c.text);
    }
  }
  return out.join('\n');
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a,b+1));
  throw new Error('Model did not return valid JSON');
}

async function handleScan(req, res) {
  if (!API_KEY) return send(res, 503, {error:'OPENAI_API_KEY is not configured. Start server.mjs with the key in the environment.'});
  let size=0, chunks=[];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(res,413,{error:'Image payload is too large'}); chunks.push(chunk); }
  let body; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res,400,{error:'Invalid JSON'}); }
  const images=(Array.isArray(body.images)?body.images:[]).filter(x=>typeof x==='string'&&/^data:image\/(png|jpe?g|webp);base64,/i.test(x)).slice(0,4);
  if (!images.length) return send(res,400,{error:'No image data'});

  const payload={
    model: MODEL,
    input:[{role:'user',content:[{type:'input_text',text:SCAN_PROMPT},...images.map(image_url=>({type:'input_image',image_url,detail:'original'}))]}],
    max_output_tokens: 1400
  };
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) return send(res,r.status,{error:data?.error?.message||'Vision request failed'});
  try {
    const parsed=parseJsonText(extractOutputText(data));
    parsed.confidence=Math.max(0,Math.min(1,Number(parsed.confidence)||0));
    parsed.material_groups=Array.isArray(parsed.material_groups)?parsed.material_groups.filter(x=>['P','M','K','N','S','H'].includes(x)):[];
    parsed.operations=Array.isArray(parsed.operations)?parsed.operations.filter(x=>['face','od','bore','groove','part','thread_ext','thread_int','drill'].includes(x)):[];
    return send(res,200,parsed);
  } catch(e) { return send(res,502,{error:e.message}); }
}

async function serveStatic(req,res){
  const u=new URL(req.url,'http://localhost'); let rel=decodeURIComponent(u.pathname);
  if(rel==='/'||rel==='') rel='/index.html';
  if(rel.includes('..') || rel.split('/').some(part=>part.startsWith('.')&&part.length>1)) return send(res,403,'forbidden','text/plain');
  const file=path.join(ROOT,rel.replace(/^\//,''));
  try { const st=await stat(file); if(!st.isFile()) throw new Error('not file'); const buf=await readFile(file); const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control': ext==='.html'?'no-cache':'public, max-age=3600'});res.end(buf); }
  catch { send(res,404,'Not found','text/plain; charset=utf-8'); }
}

const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='GET'&&req.url==='/api/health') return send(res,200,{ok:true,scanner_ai_configured:!!API_KEY,model:MODEL});
    if(req.method==='POST'&&req.url?.startsWith('/api/scan-insert')) return await handleScan(req,res);
    if(req.method==='GET'||req.method==='HEAD') return await serveStatic(req,res);
    return send(res,405,{error:'Method not allowed'});
  } catch(e) { console.error(e); return send(res,500,{error:'Server error'}); }
});
server.listen(PORT,()=>console.log(`CNC Copilot FULL v1.1.2: http://localhost:${PORT} · AI scanner ${API_KEY?'ready':'needs OPENAI_API_KEY'}`));
