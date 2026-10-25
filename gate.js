/* 진학 나침반 비밀번호 잠금. 앱 코드와 자료는 vault.js 안에 암호화돼 있고, 비밀번호로만 풀린다. */
(function(){
  var KEY='jn.gate.v1';
  var V=window.JN_VAULT;
  var box=document.getElementById('gate');
  var form=document.getElementById('gateForm');
  var input=document.getElementById('gatePw');
  var remember=document.getElementById('gateRemember');
  var msg=document.getElementById('gateMsg');
  var btn=document.getElementById('gateBtn');
  function b64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
  async function open(pw){
    var enc=new TextEncoder();
    var base=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);
    var key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(V.salt),iterations:V.iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
    var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(V.iv)},key,b64(V.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function run(src){
    return new Promise(function(res,rej){
      var u=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
      var s=document.createElement('script');s.src=u;s.onload=function(){URL.revokeObjectURL(u);res();};s.onerror=rej;
      document.body.appendChild(s);
    });
  }
  async function unlock(pw,fromSaved){
    btn.disabled=true;msg.textContent='여는 중…';
    try{
      var p=await open(pw);
      if(remember.checked||fromSaved){try{localStorage.setItem(KEY,pw);}catch(e){}}
      box.remove();
      document.getElementById('app').style.display='';document.getElementById('top').style.display='';
      await run(p.data);await run(p.app);
    }catch(e){
      btn.disabled=false;
      if(fromSaved){try{localStorage.removeItem(KEY);}catch(_){} msg.textContent='비밀번호가 바뀌었어요. 새 비밀번호를 넣어 주세요.';}
      else msg.textContent='비밀번호가 맞지 않아요.';
      input.select();
    }
  }
  form.addEventListener('submit',function(e){e.preventDefault();var pw=input.value.trim();if(pw)unlock(pw,false);});
  var saved=null;try{saved=localStorage.getItem(KEY);}catch(e){}
  if(saved){remember.checked=true;unlock(saved,true);}else{input.focus();}
})();
