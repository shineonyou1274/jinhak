/* 진학 나침반 비밀번호 잠금. 앱 코드와 자료는 vault.js 안에 암호화돼 있고, 비밀번호로만 풀린다.
   '기억하기'는 비밀번호 대신 이번 vault 전용 열쇠만 저장한다(비밀번호가 바뀌면 자동으로 무효). */
(function(){
  var OLD='jn.gate.v1', KK='jn.gate.k1';
  var V=window.JN_VAULT;
  var box=document.getElementById('gate'),form=document.getElementById('gateForm'),input=document.getElementById('gatePw'),remember=document.getElementById('gateRemember'),msg=document.getElementById('gateMsg'),btn=document.getElementById('gateBtn');
  function b64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
  function u64(u){var s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s);}
  if(!V){msg.textContent='자료를 못 받았어요. 새로고침해 주세요.';return;}
  btn.disabled=false;btn.textContent='열기';
  async function rawFromPw(pw){
    var base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64(V.salt),iterations:V.iter,hash:'SHA-256'},base,256));
  }
  async function openRaw(raw){
    var key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
    var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(V.iv)},key,b64(V.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function run(src){return new Promise(function(res,rej){var u=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));var s=document.createElement('script');s.src=u;s.onload=function(){URL.revokeObjectURL(u);res();};s.onerror=rej;document.body.appendChild(s);});}
  async function unlock(getRaw,fromSaved){
    btn.disabled=true;msg.textContent='여는 중…';
    try{
      var raw=await getRaw();var p=await openRaw(raw);
      try{localStorage.removeItem(OLD);if(remember.checked)localStorage.setItem(KK,V.salt+'|'+u64(raw));else localStorage.removeItem(KK);}catch(e){}
      box.remove();document.getElementById('app').style.display='';document.getElementById('top').style.display='';
      await run(p.data);await run(p.app);
    }catch(e){
      btn.disabled=false;
      if(fromSaved){try{localStorage.removeItem(KK);localStorage.removeItem(OLD);}catch(_){} msg.textContent='비밀번호가 바뀌었어요. 새 비밀번호를 넣어 주세요.';}
      else msg.textContent='비밀번호가 맞지 않아요.';
      input.select();
    }
  }
  form.addEventListener('submit',function(e){e.preventDefault();var pw=input.value.trim();if(pw)unlock(function(){return rawFromPw(pw);},false);});
  var savedK=null,savedOld=null;try{savedK=localStorage.getItem(KK);savedOld=localStorage.getItem(OLD);}catch(e){}
  if(savedK){remember.checked=true;var sp=savedK.split('|');if(sp[0]===V.salt)unlock(function(){return Promise.resolve(b64(sp[1]));},true);else{try{localStorage.removeItem(KK);}catch(e){} msg.textContent='비밀번호가 바뀌었어요. 새 비밀번호를 넣어 주세요.';input.focus();}}
  else if(savedOld){remember.checked=true;unlock(function(){return rawFromPw(savedOld);},true);}
  else input.focus();
})();
