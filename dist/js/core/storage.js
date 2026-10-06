const o="priroda65:";export function getItem(e,t=null){try{const r=localStorage.getItem(o+e);return r===null?t:r}catch{return t}}export function setItem(e,t){try{localStorage.setItem(o+e,t)}catch{}}
