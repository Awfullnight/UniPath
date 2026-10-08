/* UniPath Final Cloud Layer */
const CLOUD_CFG = window.UNIPATH_CONFIG || {};
const CLOUD_MODE = Boolean(CLOUD_CFG.SUPABASE_URL && CLOUD_CFG.SUPABASE_PUBLISHABLE_KEY && window.supabase);
window.UNIPATH_CLOUD = CLOUD_MODE;
let SB = null;
let cloudUser = null;
let cloudInitialized = false;

function cloudOn(){return CLOUD_MODE && !!SB}
function safeJSON(x,fallback={}){try{return x==null?fallback:JSON.parse(JSON.stringify(x))}catch(e){return fallback}}
function baseStudent(name='',email='',grade='10',cls='A',goal=''){
  return {id:'',name,class:(String(grade)+'-'+String(cls)),year:String(new Date().getFullYear()+2),email,city:'Nukus',country:'Uzbekistan',languages:'',goal:goal||'Пока не определено',ielts:null,sat:null,application:0,progress:0,portfolio:[],tests:[],diagnostic:null,lessonDone:[],checklist:{profile:false,activities:false,certificates:false,essay:false,recommendations:false,universities:false},applicationData:{firstName:(name.split(/\s+/)[0]||''),lastName:name.split(/\s+/).slice(1).join(' '),birthDate:'',address:'',phone:'',school:'UniPath School',graduationYear:String(new Date().getFullYear()+2),intendedMajor:goal||'',commonAppFeeWaiver:'No',essayTitle:'',essay:'',activities:'',awards:'',work:'',extracurricular:'',recommendationNotes:''},attendance:[]}
}
function normalizeStudentState(data,user){
  const p=data?.profile||{};
  const grade=String(p.grade||'10');
  const cls=String(p.class_name||'A').replace(/^\d+-/,'');
  const s=Object.assign(baseStudent(p.name||user?.user_metadata?.name||user?.email?.split('@')[0]||'',user?.email||p.email||'',grade,cls,p.goal||''),safeJSON(data,{}));
  s.id=user?.id||s.id; s.email=user?.email||s.email; s.name=p.name||s.name;
  s.class=p.class_name?(String(p.class_name).includes('-')?String(p.class_name):(grade+'-'+String(p.class_name))):s.class;
  s.year=p.graduationYear||s.year;
  if(!Array.isArray(s.portfolio))s.portfolio=[];
  if(!Array.isArray(s.tests))s.tests=[];
  if(!Array.isArray(s.lessonDone))s.lessonDone=[];
  if(!Array.isArray(s.attendance))s.attendance=[];
  if(!s.checklist)s.checklist=baseStudent().checklist;
  if(!s.applicationData)s.applicationData=baseStudent().applicationData;
  return s;
}
async function initCloud(){
  if(!CLOUD_MODE){if(typeof renderShell==='function'&&currentRole)renderShell();return}
  try{
    SB=window.supabase.createClient(CLOUD_CFG.SUPABASE_URL,CLOUD_CFG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    cloudInitialized=true;
    SB.auth.onAuthStateChange((_event,session)=>{cloudUser=session?.user||null;});
    const {data:{session}}=await SB.auth.getSession();
    cloudUser=session?.user||null;
    if(cloudUser) await restoreCloudSession(cloudUser); else forceLoginScreen();
  }catch(e){console.error(e);toast('Не удалось подключить Cloud: '+(e.message||e));}
}
function forceLoginScreen(){document.getElementById('login')?.classList.remove('hidden');document.getElementById('app')?.classList.add('hidden');localStorage.removeItem(ROLE);localStorage.removeItem('unipath_student_id')}
async function restoreCloudSession(user){
  try{
    const staff=await SB.from('staff_roles').select('role').eq('user_id',user.id).maybeSingle();
    if(staff.data?.role){
      currentRole='curator';localStorage.setItem(ROLE,'curator');localStorage.setItem('unipath_student_id',user.id);
      await hydrateCuratorCloud();openApp('dashboard');subscribeCuratorRealtime();return;
    }
    currentRole='student';currentStudentId=user.id;localStorage.setItem(ROLE,'student');localStorage.setItem('unipath_student_id',user.id);
    await hydrateStudentCloud(user);openApp('dashboard');
  }catch(e){console.error(e);toast('Ошибка загрузки аккаунта: '+(e.message||e));forceLoginScreen();}
}
async function hydrateStudentCloud(user){
  const {data,error}=await SB.from('student_states').select('user_id,data,updated_at').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  const s=data?.data?normalizeStudentState(data.data,user):normalizeStudentState({profile:{name:user.user_metadata?.name||'',email:user.email||'',grade:user.user_metadata?.grade||'10',class_name:user.user_metadata?.class_name||'A',goal:user.user_metadata?.goal||''}},user);
  db.users={[user.id]:s};
  db.events=db.events||[];db.plan=db.plan||[];db.materials=db.materials||[];db.reports=db.reports||[];db.notes=db.notes||[];db.manual=db.manual||[];
  await hydrateProgramCloud();
}
async function hydrateCuratorCloud(){
  const [students,prog,logs]=await Promise.all([
    SB.from('student_states').select('user_id,data,updated_at').order('updated_at',{ascending:false}),
    SB.from('program_state').select('data').eq('id','main').maybeSingle(),
    SB.from('curator_logs').select('*').order('date',{ascending:false}).limit(100)
  ]);
  if(students.error)throw students.error;
  db.users={};
  (students.data||[]).forEach(row=>{const em=row.data?.profile?.email||'';const fake={id:row.user_id,email:em,user_metadata:row.data?.profile||{}};db.users[row.user_id]=normalizeStudentState(row.data,fake)});
  if(prog.data?.data)Object.assign(db,safeJSON(prog.data.data,{}));
  db.manual=(logs.data||[]).map(x=>({id:x.id,date:x.date,text:x.title,result:x.result}));
  await hydrateProgramCloud();
}
async function hydrateProgramCloud(){
  const r=await SB.from('program_content').select('id,kind,title,payload,published').eq('published',true).order('created_at',{ascending:false});
  if(r.error)throw r.error;
  const rows=r.data||[];
  db.cloudContent=rows;
  const lessons=rows.filter(x=>x.kind==='lesson');
  if(lessons.length && currentRole!=='curator')db.materials=lessons.map(x=>({id:x.id,name:x.title,type:'Урок',classes:(String(x.payload?.grade_from||5)+'–'+String(x.payload?.grade_to||11)),status:'Опубликован',views:0,desc:x.payload?.text||''}));
  const events=rows.filter(x=>x.kind==='event');
  if(events.length && currentRole!=='curator')db.events=events.map(x=>({id:x.id,date:x.payload?.date||'',name:x.title,classes:x.payload?.classes||'5–11',type:x.payload?.event_type||'Training',participants:Number(x.payload?.participants||0),status:x.payload?.status||'Запланировано',views:Number(x.payload?.views||0),tasks:Number(x.payload?.tasks||0)}));
  db.questions=rows.filter(x=>x.kind==='question').map(x=>x.payload).filter(Boolean);
}
async function persistCloudStudent(){
  if(!cloudOn()||currentRole!=='student'||!currentStudentId)return;
  const s=db.users[currentStudentId];if(!s)return;
  const copy=safeJSON(s,{});delete copy.password;delete copy.id;
  const {error}=await SB.from('student_states').upsert({user_id:currentStudentId,data:copy});
  if(error){console.error(error);toast('Не удалось сохранить: '+error.message)}
}
async function persistCloudProgram(){
  if(!cloudOn()||currentRole!=='curator')return;
  const payload={plan:db.plan||[],events:db.events||[],materials:db.materials||[],reports:db.reports||[],notes:db.notes||[],manual:db.manual||[],requirementsState:db.requirementsState||{},settings:db.settings||{school:'UniPath School',city:'Nukus',academicYear:'2026–2027'}};
  const {error}=await SB.from('program_state').upsert({id:'main',data:payload});
  if(error){console.error(error);toast('Не удалось сохранить программу: '+error.message)}
}
async function save(){try{localStorage.setItem(STORAGE,JSON.stringify(db))}catch(e){}if(cloudOn())return currentRole==='student'?persistCloudStudent():persistCloudProgram()}

async function login(){
  const email=normalizeEmail(document.getElementById('loginEmail').value),pass=document.getElementById('loginPass').value,err=document.getElementById('loginError');err.textContent='';
  if(!email.includes('@')){err.textContent='Введите корректный email.';return}if(!pass){err.textContent='Введите пароль.';return}
  if(!cloudOn()){
    if(email===DEMO_ACCOUNTS.curator.email&&pass===DEMO_ACCOUNTS.curator.password){currentRole='curator';currentStudentId='s1';localStorage.setItem(ROLE,'curator');localStorage.setItem('unipath_student_id',currentStudentId);openApp('dashboard');return}
    const entry=Object.values(db.users).find(u=>normalizeEmail(u.email)===email&&u.password===pass);if(!entry){err.textContent='Аккаунт с таким email и паролем не найден.';return}currentRole='student';currentStudentId=entry.id;localStorage.setItem(ROLE,currentRole);localStorage.setItem('unipath_student_id',currentStudentId);openApp('dashboard');return;
  }
  const {data,error}=await SB.auth.signInWithPassword({email,password:pass});
  if(error){err.textContent=error.message;return}
  if(data.user)await restoreCloudSession(data.user);
}
async function registerStudent(){
  const name=document.getElementById('regName').value.trim(),cls=document.getElementById('regClass').value,email=normalizeEmail(document.getElementById('regEmail').value),goal=document.getElementById('regGoal').value.trim(),pass=document.getElementById('regPass').value,pass2=document.getElementById('regPass2').value,err=document.getElementById('loginError');err.textContent='';
  if(name.length<3){err.textContent='Укажи имя и фамилию.';return}if(!email.includes('@')||!email.includes('.')){err.textContent='Введите корректный email.';return}if(email===DEMO_ACCOUNTS.curator.email){err.textContent='Этот email зарезервирован.';return}if(pass.length<8){err.textContent='Пароль должен содержать минимум 8 символов.';return}if(pass!==pass2){err.textContent='Пароли не совпадают.';return}
  if(!cloudOn()){
    if(Object.values(db.users).some(u=>normalizeEmail(u.email)===email)){err.textContent='Аккаунт с таким email уже существует.';return}
    const id=uid('s'),parts=cls.split('-'),g=parts[0],c=parts[1],year=String(new Date().getFullYear()+Math.max(1,12-parseInt(g,10)+1));const user=baseStudent(name,email,g,c,goal);user.id=id;user.year=year;user.class=cls;user.applicationData.graduationYear=year;user.applicationData.intendedMajor=goal;user.password=pass;db.users[id]=user;await save();currentRole='student';currentStudentId=id;localStorage.setItem(ROLE,currentRole);localStorage.setItem('unipath_student_id',id);toast('Аккаунт создан');openApp('dashboard');return;
  }
  const parts=cls.split('-'),g=parts[0];
  const {data,error}=await SB.auth.signUp({email,password:pass,options:{data:{name,grade:g,class_name:cls,goal}}});
  if(error){err.textContent=error.message;return}
  if(data.user){
    currentRole='student';currentStudentId=data.user.id;localStorage.setItem(ROLE,currentRole);localStorage.setItem('unipath_student_id',data.user.id);
    if(data.session){await restoreCloudSession(data.user)}else{err.textContent='Аккаунт создан. Проверь email и перейди по ссылке подтверждения.';switchAuth('login')}
  }
}
async function logout(){try{if(cloudOn())await SB.auth.signOut()}catch(e){console.error(e)}localStorage.removeItem(ROLE);localStorage.removeItem('unipath_student_id');currentRole='';cloudUser=null;forceLoginScreen();switchAuth('login')}

async function addCertificate(){
  const f=document.getElementById('certFile')?.files[0],name=val('certName').trim();if(!name||!f)return toast('Укажите название и файл');if(f.size>10*1024*1024)return toast('Файл больше 10 МБ');
  const s=db.users[currentStudentId],item={id:uid('cert'),n:name,t:'Certificate',d:val('certDate')||new Date().toISOString().slice(0,10),status:'Загружено',file:null};
  if(cloudOn()){
    const path=currentStudentId+'/certificates/'+Date.now()+'_'+f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await SB.storage.from('student-files').upload(path,f,{upsert:false});if(up.error)return toast('Не удалось загрузить файл: '+up.error.message);item.file={name:f.name,size:f.size,type:f.type,path};
  }else{
    const reader=new FileReader();reader.onload=()=>{item.file={name:f.name,size:f.size,type:f.type,data:reader.result};s.portfolio.push(item);s.checklist.certificates=true;save();closeModal();showPage('portfolio');toast('Сертификат сохранён')};reader.readAsDataURL(f);return;
  }
  s.portfolio.push(item);s.checklist.certificates=true;await save();closeModal();showPage('portfolio');toast('Сертификат загружен');
}
async function downloadFile(id){
  const p=db.users[currentStudentId].portfolio.find(x=>String(x.id)===String(id));if(!p?.file)return;
  if(cloudOn()&&p.file.path){const r=await SB.storage.from('student-files').createSignedUrl(p.file.path,300);if(r.error)return toast('Не удалось открыть файл');window.open(r.data.signedUrl,'_blank');return;}
  if(p.file.data){const a=document.createElement('a');a.href=p.file.data;a.download=p.file.name||'file';a.click();}
}

let __rec=null,__chunks=[];
function startSpeakingRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('Запись голоса не поддерживается этим браузером.');
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{__chunks=[];__rec=new MediaRecorder(stream);__rec.ondataavailable=e=>e.data.size&&__chunks.push(e.data);__rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(__chunks,{type:'audio/webm'});if(cloudOn()){const path=currentStudentId+'/speaking/'+Date.now()+'.webm';const up=await SB.storage.from('student-files').upload(path,blob,{contentType:'audio/webm',upsert:false});if(!up.error&&testState){testState.speakingPath=path;toast('Запись загружена')}}else if(testState){testState.speakingLocal=URL.createObjectURL(blob);toast('Запись сохранена для этой попытки')}};__rec.start();toast('Запись началась')}).catch(()=>toast('Браузер не разрешил доступ к микрофону.'));
}
function stopSpeakingRecording(){if(__rec&&__rec.state!=='inactive'){__rec.stop();toast('Останавливаем запись…')}else toast('Запись не идёт')}

const oldQuestionHTML=questionHTML;
questionHTML=function(si,qi,q){
  const key=si+'-'+qi,ans=testState.answers[key];
  if(q.kind==='speaking')return '<div class="question"><div class="question-title">'+(qi+1)+'. '+esc(q.q)+'</div><textarea data-answer="'+key+'" oninput="setAnswer(\''+key+'\',this.value)" placeholder="Краткий план ответа или заметки…"></textarea><div class="actions" style="margin-top:10px"><button class="btn secondary" onclick="speakText(\'Describe a project or activity you are proud of. Speak for one to two minutes.\')">🔊 Озвучить prompt</button><button class="btn" onclick="startSpeakingRecording()">🎙️ Запись</button><button class="btn danger" onclick="stopSpeakingRecording()">■ Стоп</button><label class="small">Self-check band<select id="speakBand" onchange="setAnswer(\''+key+'\',this.value)"><option value="4">4.0</option><option value="5">5.0</option><option value="6">6.0</option><option value="6.5">6.5</option><option value="7" selected>7.0</option><option value="7.5">7.5</option><option value="8">8.0</option><option value="8.5">8.5</option><option value="9">9.0</option></select></label></div><div class="score-note">В production Speaking должен оцениваться по официальным критериям; self-check здесь — тренировочная оценка.</div></div>';
  return oldQuestionHTML(si,qi,q);
}

function ieltsBandFromRaw(raw,section){const x=Math.round((raw/10)*40);if(section==='Listening'){if(x>=39)return 9;if(x>=36)return 8.5;if(x>=35)return 8;if(x>=32)return 7.5;if(x>=30)return 7;if(x>=26)return 6.5;if(x>=23)return 6;if(x>=18)return 5.5;if(x>=16)return 5;return 4.5}else{if(x>=39)return 9;if(x>=37)return 8.5;if(x>=35)return 8;if(x>=33)return 7.5;if(x>=30)return 7;if(x>=27)return 6.5;if(x>=23)return 6;if(x>=19)return 5.5;if(x>=15)return 5;return 4.5}}
function roundIELTS(v){return Math.min(9,Math.round(v*2)/2)}
function scoreIELTS(ans){let r=0,l=0;const rQs=activeTest?.sections?.[0]?.questions||IELTS[0].questions;const lQs=activeTest?.sections?.[1]?.questions||IELTS[1].questions;rQs.forEach((q,i)=>{if(String(ans['0-'+i])===String(q.c))r++});lQs.forEach((q,i)=>{if(String(ans['1-'+i])===String(q.c))l++});const rb=ieltsBandFromRaw(r,'Reading'),lb=ieltsBandFromRaw(l,'Listening'),writingWords=String(ans['2-0']||'').trim().split(/\s+/).filter(Boolean).length,wb=writingWords>=250?6.5:writingWords>=180?6:writingWords>=150?5.5:4.5,sb=Number(ans['3-0']||document.getElementById('speakBand')?.value||7),overall=roundIELTS((rb+lb+wb+sb)/4);return{band:overall,score:overall.toFixed(1),detail:'Reading '+rb.toFixed(1)+' • Listening '+lb.toFixed(1)+' • Writing '+wb.toFixed(1)+' (provisional, '+writingWords+' words) • Speaking '+sb.toFixed(1)+' self-check',reading:rb,listening:lb,writing:wb,speaking:sb}}
function satSectionScore(correct,total){return Math.max(200,Math.min(800,Math.round((200+(correct/total)*600)/10)*10))}
function scoreSAT(ans){let rw=0,m=0;const rwQs=activeTest?.sections?.[0]?.questions||SAT[0].questions;const mQs=activeTest?.sections?.[1]?.questions||SAT[1].questions;rwQs.forEach((q,i)=>{if(String(ans['0-'+i])===String(q.c))rw++});mQs.forEach((q,i)=>{if(String(ans['1-'+i])===String(q.c))m++});const rwScore=satSectionScore(rw,rwQs.length),mScore=satSectionScore(m,mQs.length);return{total:rwScore+mScore,score:String(rwScore+mScore),detail:'Reading & Writing '+rwScore+' • Math '+mScore+' • correct '+(rw+m)+'/'+(SAT[0].questions.length+SAT[1].questions.length)+' • practice estimate',rw:rwScore,math:mScore}}
async function submitActiveTest(){if(!activeTest)return;collectVisibleAnswers();clearInterval(testTimer);const result=activeTest.scoreFn(testState.answers),s=db.users[currentStudentId],attempt={id:Date.now(),type:activeTest.type,name:activeTest.name+' #'+(s.tests.filter(x=>x.type===activeTest.type).length+1),score:result.score,detail:result.detail,date:new Date().toLocaleDateString('ru-RU'),createdAt:new Date().toISOString(),sections:activeTest.type==='IELTS'?{reading:result.reading,listening:result.listening,writing:result.writing,speaking:result.speaking}:{rw:result.rw,math:result.math},answers:safeJSON(testState.answers),speakingPath:testState.speakingPath||null};s.tests.unshift(attempt);if(activeTest.type==='IELTS')s.ielts=result.band;else if(activeTest.type==='SAT')s.sat=result.total;s.progress=Math.min(100,s.progress+3);await save();activeTest=null;testState=null;closeModal();showPage('tests');toast('Результат сохранён: '+result.score)}

const __saveProfile=saveProfile;saveProfile=async function(){__saveProfile();await save()}
const __saveApplication=saveApplication;saveApplication=async function(){__saveApplication();await save()}
const __finishLesson=finishLesson;finishLesson=async function(id){__finishLesson(id);await save()}
const __finishCareer=finishCareer;finishCareer=async function(){__finishCareer();await save()}

function mergeCloudQuestions(sectionName,base){const custom=(db.questions||[]).filter(q=>q.test===sectionName&&q.options?.length);return custom.length?custom.concat(base):base}
function startIELTS(){const sections=clone(IELTS);sections[0].questions=mergeCloudQuestions('IELTS Reading',sections[0].questions);sections[1].questions=mergeCloudQuestions('IELTS Listening',sections[1].questions);startTest({type:'IELTS',name:'IELTS Academic Mock',duration:40,sections,scoreFn:scoreIELTS})}
function startSAT(){const sections=clone(SAT);sections[0].questions=mergeCloudQuestions('SAT Reading & Writing',sections[0].questions);sections[1].questions=mergeCloudQuestions('SAT Math',sections[1].questions);startTest({type:'SAT',name:'SAT Digital Mock',duration:70,sections,scoreFn:scoreSAT})}

const __navItems=navItems;navItems=function(){const a=__navItems();if(currentRole==='curator')a.push(['questionbank','Банк вопросов','?']);return a}
const __renderCuratorPage=renderCuratorPage;renderCuratorPage=function(page){if(page==='questionbank'){setHeader('Банк вопросов','Добавляй и публикуй свои задания без изменения кода','CONTENT');document.getElementById('content').innerHTML=questionBankPage();return}__renderCuratorPage(page)}
function questionBankPage(){const qs=db.questions||[];return '<div class="actions" style="margin-bottom:15px"><button class="btn" onclick="openQuestionModal()">+ Добавить вопрос</button></div><div class="grid g2">'+['IELTS Reading','IELTS Listening','SAT Reading & Writing','SAT Math','Career'].map(type=>{const arr=qs.filter(q=>q.test===type);return '<div class="card"><h3>'+esc(type)+'</h3><div class="stat">'+arr.length+'</div><div class="muted">вопросов в базе</div>'+(arr.slice(0,5).map((q,i)=>'<div class="listrow"><div><b>'+(i+1)+'. '+esc(q.q)+'</b><div class="muted">'+esc(q.skill||'General')+'</div></div><span class="tag success">Published</span></div>').join('')||'<div class="empty">Пока пусто.</div>')+'</div>'}).join('')+'</div><br><div class="card"><div class="score-note">Здесь можно постепенно наращивать собственный банк оригинальных заданий. Официальные вопросы IELTS/SAT не копируются в проект без соответствующих прав.</div></div>'}
function openQuestionModal(){document.getElementById('modalContent').innerHTML='<h3>Добавить вопрос</h3><div class="form"><label>Тест<select id="qTest"><option>IELTS Reading</option><option>IELTS Listening</option><option>SAT Reading & Writing</option><option>SAT Math</option></select></label><label>Вопрос<textarea id="qText"></textarea></label><label>Навык / тема<input id="qSkill" placeholder="Main idea / Algebra / Grammar"></label><label>Варианты по одному на строку<textarea id="qOpts" placeholder="A\nB\nC\nD"></textarea></label><label>Номер правильного варианта<input id="qCorrect" type="number" min="0" max="3" value="0"></label><button class="btn" onclick="addQuestionBankItem()">Сохранить и опубликовать</button></div>';openModal()}
async function addQuestionBankItem(){const test=val('qTest'),q=val('qText').trim(),skill=val('qSkill').trim(),options=val('qOpts').split(/\n/).map(s=>s.trim()).filter(Boolean),c=Number(val('qCorrect'));if(!q||options.length<2||c<0||c>=options.length)return toast('Заполни вопрос, варианты и правильный ответ');const item={id:uid('q'),test,q,skill,options,c};db.questions=(db.questions||[]).concat(item);if(cloudOn()){const ins=await SB.from('program_content').insert({kind:'question',title:q,payload:item,published:true});if(ins.error)return toast('Не удалось сохранить вопрос: '+ins.error.message)}await save();closeModal();showPage('questionbank');toast('Вопрос опубликован')}

function openIELTSReview(studentId){const s=db.users[studentId];if(!s)return;const d=s.ieltsDetail||{};document.getElementById('modalContent').innerHTML='<h3>IELTS review • '+esc(s.name)+'</h3><p class="muted">Ввод куратора для Writing/Speaking. Reading/Listening берутся из последней попытки.</p><div class="form"><label>Writing band<input id="revW" type="number" step="0.5" min="0" max="9" value="'+(d.writing||'')+'"></label><label>Speaking band<input id="revS" type="number" step="0.5" min="0" max="9" value="'+(d.speaking||'')+'"></label><button class="btn" onclick="saveIELTSReview(\''+studentId+'\')">Сохранить оценку</button></div>';openModal()}
async function saveIELTSReview(studentId){const s=db.users[studentId],attempt=s.tests.find(x=>x.type==='IELTS');if(!attempt)return toast('У ученика ещё нет IELTS попытки');const rb=Number(attempt.sections?.reading||0),lb=Number(attempt.sections?.listening||0),wb=Number(val('revW')),sb=Number(val('revS'));if(!(wb>0)||!(sb>0))return toast('Введите Writing и Speaking');const overall=roundIELTS((rb+lb+wb+sb)/4);s.ielts=overall;s.ieltsDetail={overall,reading:rb,listening:lb,writing:wb,speaking:sb};attempt.detail='Reading '+rb.toFixed(1)+' • Listening '+lb.toFixed(1)+' • Writing '+wb.toFixed(1)+' • Speaking '+sb.toFixed(1)+' • Reviewed by curator';attempt.score=overall.toFixed(1);if(cloudOn()){const copy=safeJSON(s,{});delete copy.id;delete copy.password;const up=await SB.from('student_states').upsert({user_id:studentId,data:copy});if(up.error)return toast('Не удалось сохранить review: '+up.error.message)}else{save()}closeModal();showPage('students');toast('IELTS оценка обновлена')}

function studentProgram(s){const events=(db.events||[]).filter(e=>e.status!=='Завершено').slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));return '<div class="grid g2"><div class="card hero"><h2>Твоя программа</h2><p>События, тренинги и ближайшие дедлайны.</p></div><div class="card"><h3>Участие</h3><div class="stat">'+(s.attendance||[]).length+'</div><div class="muted">отмеченных мероприятий</div></div></div><br><div class="card"><h3>Ближайшие события</h3>'+(events.map(e=>'<div class="listrow"><div><b>'+esc(e.name)+'</b><div class="muted">'+fmtDate(e.date)+' • '+esc(e.classes)+' • '+esc(e.type)+'</div></div><button class="btn secondary" onclick="markAttendance(\''+e.id+'\')">'+((s.attendance||[]).includes(String(e.id))?'✓ Посещено':'Я участвовал')+'</button></div>').join('')||'<div class="empty">Пока нет опубликованных событий.</div>')+'</div>'}
function markAttendance(id){const s=db.users[currentStudentId];s.attendance=s.attendance||[];id=String(id);if(!s.attendance.includes(id))s.attendance.push(id);save();showPage('program');toast('Участие сохранено')}

navItems=(function(prev){return function(){const a=prev();if(currentRole==='student')a.splice(6,0,['program','Мероприятия','✦']);return a}})(navItems)
const __renderStudentPage=renderStudentPage;renderStudentPage=function(page){if(page==='program'){const s=db.users[currentStudentId];setHeader('Мероприятия','Семинары, тренинги и события','PROGRAM');document.getElementById('content').innerHTML=studentProgram(s);return}__renderStudentPage(page)}

const __curatorAnalytics=curatorAnalytics;curatorAnalytics=function(){const ss=Object.values(db.users||{}),attempts=ss.flatMap(s=>s.tests||[]),ielts=attempts.filter(t=>t.type==='IELTS'),sat=attempts.filter(t=>t.type==='SAT'),career=attempts.filter(t=>t.type==='Career');const avg=n=>Math.round((n.reduce((a,b)=>a+(Number(b)||0),0)/Math.max(1,n.length))*10)/10;const progress=avg(ss.map(s=>s.progress)),app=avg(ss.map(s=>s.application));const avgI=avg(ielts.map(t=>Number(t.score))),avgS=avg(sat.map(t=>Number(t.score)));const attendance=ss.reduce((a,s)=>a+(s.attendance?.length||0),0);return '<div class="grid g4"><div class="card"><div class="kpi">Ученики</div><div class="stat">'+ss.length+'</div><div class="muted">облачных профилей</div></div><div class="card"><div class="kpi">Средний progress</div><div class="stat">'+progress+'%</div><div class="muted">учёба + activity</div></div><div class="card"><div class="kpi">Средний application</div><div class="stat">'+app+'%</div><div class="muted">готовность заявки</div></div><div class="card"><div class="kpi">Attendance</div><div class="stat">'+attendance+'</div><div class="muted">отмеченных участий</div></div></div><br><div class="grid g2"><div class="card"><h3>Тестовая аналитика</h3><div class="listrow"><span>IELTS attempts</span><b>'+ielts.length+'</b></div><div class="listrow"><span>Средний IELTS</span><b>'+(avgI||'—')+'</b></div><div class="listrow"><span>SAT attempts</span><b>'+sat.length+'</b></div><div class="listrow"><span>Средний SAT</span><b>'+(avgS||'—')+'</b></div><div class="listrow"><span>Career diagnostics</span><b>'+career.length+'</b></div></div><div class="card"><h3>Охват</h3><div class="progressrow"><span>IELTS</span><div class="bar"><i style="width:'+Math.round(ielts.length/Math.max(1,ss.length)*100)+'%"></i></div><b>'+Math.round(ielts.length/Math.max(1,ss.length)*100)+'%</b></div><div class="progressrow"><span>SAT</span><div class="bar"><i style="width:'+Math.round(sat.length/Math.max(1,ss.length)*100)+'%"></i></div><b>'+Math.round(sat.length/Math.max(1,ss.length)*100)+'%</b></div><div class="progressrow"><span>Diagnostic</span><div class="bar"><i style="width:'+Math.round(career.length/Math.max(1,ss.length)*100)+'%"></i></div><b>'+Math.round(career.length/Math.max(1,ss.length)*100)+'%</b></div></div></div><br>'+__curatorAnalytics()}

const __openStudent=openStudent;openStudent=function(id){__openStudent(id);const wrap=document.getElementById('modalContent');if(wrap&&currentRole==='curator')wrap.innerHTML+='<div class="actions" style="margin-top:12px"><button class="btn secondary" onclick="openIELTSReview(\''+id+'\')">📝 IELTS review</button></div>'}


const __addManual=addManual;addManual=async function(){
  const text=val('mrText').trim();if(!text)return toast('Введите активность');
  if(cloudOn()){
    const ins=await SB.from('curator_logs').insert({date:val('mrDate')||new Date().toISOString().slice(0,10),title:text,result:val('mrResult').trim(),created_by:cloudUser.id});
    if(ins.error)return toast('Не удалось сохранить запись: '+ins.error.message);
    await hydrateCuratorCloud();closeModal();showPage('events');toast('Запись добавлена');return;
  }
  __addManual();
};

const __addStudent=addStudent;addStudent=async function(){
  if(cloudOn())return toast('В Cloud-режиме ученик создаёт личный аккаунт сам через «Создать аккаунт». Куратор затем видит его автоматически.');
  __addStudent();
};

function subscribeCuratorRealtime(){
  if(!cloudOn()||currentRole!=='curator')return;
  try{SB.channel('unipath-live').on('postgres_changes',{event:'*',schema:'public',table:'student_states'},async()=>{await hydrateCuratorCloud();if(currentPage==='analytics'||currentPage==='dashboard'||currentPage==='students'||currentPage==='classes')showPage(currentPage)}).subscribe()}catch(e){console.warn(e)}
}

window.addEventListener('DOMContentLoaded',()=>{if(CLOUD_MODE)setTimeout(initCloud,0);else{const banner=document.getElementById('badge');if(banner)banner.textContent='DEMO / LOCAL'}});
