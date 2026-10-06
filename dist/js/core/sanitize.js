export function cleanText(e,{multiline:r=!1}={}){if(typeof e!="string")return"";let t=e.normalize("NFC").replace(/[<>]/g,"");return r?t=t.replace(/\r\n?/g,`
`).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,`

`):t=t.replace(/[\u0000-\u001F\u007F]/g,"").replace(/\s+/g," "),t.trim()}export function safeColor(e,r){return typeof e=="string"&&/^#[0-9A-Fa-f]{6}$/.test(e)?e:r}export function safeHttpsUrl(e){if(typeof e!="string")return null;try{const r=new URL(e);return r.protocol==="https:"?r.href:null}catch{return null}}
