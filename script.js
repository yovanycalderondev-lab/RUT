  // ============================================================
  // CONFIGURA ESTO ANTES DE DESPLEGAR
  // ============================================================
  const SUPABASE_URL = 'https://ublmrpqtbnugfemthakx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibG1ycHF0Ym51Z2ZlbXRoYWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MDY5NDcsImV4cCI6MjEwMTI4Mjk0N30.rBXJQFsehD1f0eEsEgTiDA1kOd8-tjx-N18PIWZiVbA';
  // ============================================================

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ROLES = ['Capitán', 'Auditor', 'Guardián del Tiempo'];
  let sesionActual = null;
  let squadActual = null;
  let nombreActual = 'Vos';

  if (SUPABASE_URL.includes('TU-PROYECTO')) {
    document.getElementById('devBanner').style.display = 'block';
  }

  // ---------- AUTH MODAL ----------
  let tabActivo = 'login';
  function abrirModal(){ document.getElementById('modalBg').classList.add('open'); }
  function cerrarModal(){ document.getElementById('modalBg').classList.remove('open'); document.getElementById('authMsg').textContent=''; }
  function cambiarTab(tab){
    tabActivo = tab;
    document.getElementById('tabLogin').classList.toggle('active', tab==='login');
    document.getElementById('tabSignup').classList.toggle('active', tab==='signup');
    document.getElementById('modalTitle').textContent = tab==='login' ? 'Entrar a tu squad' : 'Crear cuenta gratis';
    document.getElementById('authNombre').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('labelNombre').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('authDisponibilidad').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('labelDisponibilidad').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('authPassConfirm').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('labelPassConfirm').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('passHint').style.display = tab==='signup' ? 'block' : 'none';
    document.getElementById('authPass').setAttribute('autocomplete', tab==='signup' ? 'new-password' : 'current-password');
    document.getElementById('btnOlvide').style.display = tab==='login' ? 'inline-flex' : 'none';
    document.getElementById('authMsg').textContent = '';
  }

  async function enviarAuth(){
    const email = document.getElementById('authEmail').value.trim();
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('authMsg');
    msg.className = 'modal-msg';
    msg.textContent = 'Procesando...';
    try{
      if (tabActivo === 'signup'){
        const nombre = document.getElementById('authNombre').value.trim();
        const passConfirm = document.getElementById('authPassConfirm').value;
        const disponibilidad = document.getElementById('authDisponibilidad').value;
        if (!nombre || !email || !pass){ msg.textContent='Completa nombre, correo y contraseña.'; msg.classList.add('err'); return; }
        if (pass.length < 6){ msg.textContent='La contraseña debe tener al menos 6 caracteres.'; msg.classList.add('err'); return; }
        if (pass !== passConfirm){ msg.textContent='Las contraseñas no coinciden.'; msg.classList.add('err'); return; }
        const { data, error } = await sb.auth.signUp({ email, password: pass });
        if (error) throw error;
        if (!data.session){
          msg.classList.add('ok');
          msg.textContent = 'Cuenta creada. Revisa tu correo para confirmar antes de entrar (o desactiva "Confirm email" en Supabase para la demo).';
          return;
        }
        const { error: errPerfil } = await sb.from('profiles').insert({ id: data.user.id, nombre, disponibilidad });
        if (errPerfil) throw errPerfil;
        sesionActual = data.user;
        await unirseOCrearSquad(sesionActual.id, disponibilidad);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        sesionActual = data.user;
      }
      msg.classList.add('ok'); msg.textContent = '¡Listo!';
      await cargarDashboard();
      await cargarEmpleabilidad();
      setTimeout(cerrarModal, 500);
    } catch(err){
      msg.classList.add('err'); msg.textContent = err.message || 'Algo falló. Intenta de nuevo.';
    }
  }

  async function recuperarPassword(){
    const email = document.getElementById('authEmail').value.trim();
    const msg = document.getElementById('authMsg');
    msg.className = 'modal-msg';
    if (!email){ msg.textContent = 'Escribe tu correo arriba primero.'; msg.classList.add('err'); return; }
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) throw error;
      msg.classList.add('ok'); msg.textContent = 'Te enviamos un enlace para restablecer tu contraseña.';
    } catch(err){
      msg.classList.add('err'); msg.textContent = err.message || 'No se pudo enviar el correo. Intenta de nuevo.';
    }
  }

  async function cerrarSesion(){
    if (enLlamada) await colgarLlamada();
    if (canalChat){ sb.removeChannel(canalChat); canalChat = null; }
    if (canalEditor){ sb.removeChannel(canalEditor); canalEditor = null; }
    clearTimeout(guardadoTimeout);
    document.getElementById('editorTextarea').value = '';
    document.getElementById('editorPresence').innerHTML = '';
    await sb.auth.signOut();
    sesionActual = null; squadActual = null;
    document.getElementById('authGate').style.display = 'block';
    document.getElementById('squadPanel').style.display = 'none';
    document.getElementById('navAuthBtn').textContent = 'Entrar';
    await cargarEmpleabilidad();
  }

  // ---------- SQUAD MATCHMAKING ----------
  // MVP: recorre squads abiertos y se une al primero con cupo (<4). Si ninguno tiene
  // cupo, crea uno nuevo. Para producción a mayor escala, mueve esto a una función
  // RPC de Postgres para evitar condiciones de carrera si dos personas se unen
  // al mismo tiempo al último cupo.
  async function unirseOCrearSquad(userId, disponibilidad){
    const { data: existente } = await sb.from('squad_members').select('squad_id').eq('user_id', userId).maybeSingle();
    if (existente) return existente.squad_id;

    const { data: squads, error: errSquads } = await sb.from('squads').select('id, created_at')
      .eq('activo', true).eq('disponibilidad', disponibilidad).order('created_at', { ascending: true });
    if (errSquads) throw errSquads;

    if (squads){
      for (const squad of squads){
        const { count } = await sb.from('squad_members').select('*', { count:'exact', head:true }).eq('squad_id', squad.id);
        if (count < 4){
          const { error: errUnion } = await sb.from('squad_members').insert({ squad_id: squad.id, user_id: userId, orden: count });
          if (errUnion) throw errUnion;
          return squad.id;
        }
      }
    }
    const { data: nuevo, error: errNuevo } = await sb.from('squads').insert({ disponibilidad }).select().single();
    if (errNuevo) throw errNuevo;
    const { error: errMiembro } = await sb.from('squad_members').insert({ squad_id: nuevo.id, user_id: userId, orden: 0 });
    if (errMiembro) throw errMiembro;
    return nuevo.id;
  }

  // ---------- MODO DEMO (sin login, sin Supabase — solo para mostrar la app viva) ----------
  function activarModoDemo(){
    if (canalChat) sb.removeChannel(canalChat);
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('squadPanel').style.display = 'block';
    document.getElementById('navAuthBtn').textContent = 'Modo demo';
    document.getElementById('adSlot').style.display = 'block';
    document.getElementById('streakNum').textContent = '6';

    const demoMiembros = [
      { nombre:'Vos', rol:'Capitán', hizo:true },
      { nombre:'María José', rol:'Auditor', hizo:true },
      { nombre:'Diego', rol:'Guardián del Tiempo', hizo:true },
      { nombre:'Ana Lucía', rol:'Libre esta semana', hizo:false },
    ];
    const grid = document.getElementById('memberGrid');
    grid.innerHTML = '';
    demoMiembros.forEach(m => {
      const div = document.createElement('div');
      div.className = 'member';
      div.innerHTML = `<div class="member-dot ${m.hizo ? 'done' : ''}"></div>
        <div class="member-name">${escaparHtml(m.nombre)}</div>
        <div class="member-role">${escaparHtml(m.rol)}</div>`;
      grid.appendChild(div);
    });

    const demoChat = [
      { autor:'María José', texto:'Ya subí el navbar responsive, revisen porfa 👀' },
      { autor:'Diego', texto:'Buenísimo, yo termino el formulario de contacto en un rato' },
      { autor:'Vos', texto:'Dale, yo seguí con el hero. No rompemos la racha hoy 🔥' },
      { autor:'Ana Lucía', texto:'Voy tarde pero ya voy, denme 20 min' },
    ];
    const cont = document.getElementById('chatMessages');
    cont.innerHTML = '';
    demoChat.forEach(m => {
      const div = document.createElement('div');
      div.className = 'chat-bubble' + (m.autor === 'Vos' ? ' mine' : '');
      div.innerHTML = `<div class="chat-author">${m.autor === 'Vos' ? 'Tú' : escaparHtml(m.autor)}</div>${escaparHtml(m.texto)}`;
      cont.appendChild(div);
    });
    cont.scrollTop = cont.scrollHeight;

    xpTotal = 140;
    progresoLecciones = new Set(['prog-1','prog-2','cocina-1']);
    actualizarStatsLecciones();
    renderLeccionPath();

    document.getElementById('dashboard').scrollIntoView({ behavior:'smooth' });
  }

  // ---------- DASHBOARD ----------
  async function cargarDashboard(){
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('squadPanel').style.display = 'block';
    document.getElementById('navAuthBtn').textContent = 'Mi squad';

    const { data: miembro } = await sb.from('squad_members').select('squad_id').eq('user_id', sesionActual.id).maybeSingle();
    if (!miembro) return;
    squadActual = miembro.squad_id;

    const { data: squad } = await sb.from('squads').select('*').eq('id', squadActual).single();
    const { data: miembros } = await sb.from('squad_members').select('orden, user_id, profiles(nombre)').eq('squad_id', squadActual).order('orden');
    const { data: miPerfil } = await sb.from('profiles').select('premium, nombre, github_usuario').eq('id', sesionActual.id).maybeSingle();
    document.getElementById('adSlot').style.display = miPerfil?.premium ? 'none' : 'block';
    nombreActual = miPerfil?.nombre || 'Vos';
    githubUsuarioActual = miPerfil?.github_usuario || null;
    const inputGithub = document.getElementById('githubUsuarioInput');
    if (inputGithub) inputGithub.value = githubUsuarioActual || '';

    const hoy = new Date().toISOString().slice(0,10);
    const { data: evidenciaHoy } = await sb.from('evidence_logs').select('user_id').eq('squad_id', squadActual).eq('fecha', hoy);
    const idsConEvidencia = new Set((evidenciaHoy||[]).map(e => e.user_id));

    const semanas = Math.floor((Date.now() - new Date(squad.created_at)) / (7*24*60*60*1000));
    const grid = document.getElementById('memberGrid');
    grid.innerHTML = '';
    (miembros||[]).forEach(m => {
      const idxRol = (semanas + m.orden) % 4;
      const rol = idxRol < 3 ? ROLES[idxRol] : 'Libre esta semana';
      const div = document.createElement('div');
      div.className = 'member';
      div.innerHTML = `
        <div class="member-dot ${idsConEvidencia.has(m.user_id) ? 'done' : ''}"></div>
        <div class="member-name">${escaparHtml(m.profiles?.nombre || 'Squad member')}</div>
        <div class="member-role">${escaparHtml(rol)}</div>`;
      grid.appendChild(div);
    });

    document.getElementById('streakNum').textContent = await calcularRachaSquad(squadActual, (miembros||[]).length || 4);
    suscribirseAlChat(squadActual);
    suscribirseAlEditor(squadActual);
    await cargarProgresoLecciones();
  }

  // ---------- CHAT PROPIO EN VIVO (Supabase Realtime, sin Discord) ----------
  let canalChat = null;

  function escaparHtml(str){
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  }

  function pintarMensaje(m){
    const cont = document.getElementById('chatMessages');
    const div = document.createElement('div');
    const esMio = sesionActual && m.user_id === sesionActual.id;
    div.className = 'chat-bubble' + (esMio ? ' mine' : '');
    div.innerHTML = `<div class="chat-author">${esMio ? 'Tú' : escaparHtml(m.profiles?.nombre || 'Squad')}</div>${escaparHtml(m.contenido)}`;
    cont.appendChild(div);
    cont.scrollTop = cont.scrollHeight;
  }

  async function cargarMensajesPrevios(squadId){
    const cont = document.getElementById('chatMessages');
    cont.innerHTML = '';
    const { data } = await sb.from('squad_messages').select('*, profiles(nombre)').eq('squad_id', squadId).order('created_at', { ascending:true }).limit(50);
    (data||[]).forEach(m => pintarMensaje(m));
  }

  function suscribirseAlChat(squadId){
    if (canalChat) sb.removeChannel(canalChat);
    cargarMensajesPrevios(squadId);
    canalChat = sb.channel(`chat-${squadId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'squad_messages', filter:`squad_id=eq.${squadId}` }, payload => pintarMensaje(payload.new))
      .subscribe();
  }

  async function enviarMensaje(event){
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const contenido = input.value.trim();
    if (!contenido || !squadActual) return false;
    input.value = '';
    await sb.from('squad_messages').insert({ squad_id: squadActual, user_id: sesionActual.id, contenido });
    return false;
  }

  async function calcularRachaSquad(squadId, totalMiembros){
    const { data } = await sb.from('evidence_logs').select('fecha, user_id').eq('squad_id', squadId).order('fecha', { ascending:false });
    if (!data || !data.length) return 0;
    const porFecha = {};
    data.forEach(row => { (porFecha[row.fecha] ||= new Set()).add(row.user_id); });
    const fechas = Object.keys(porFecha).sort().reverse();
    let racha = 0, cursor = new Date();
    for (const f of fechas){
      const diffDias = Math.round((cursor - new Date(f)) / 86400000);
      if (diffDias > 1) break;
      if (porFecha[f].size >= totalMiembros){ racha++; cursor = new Date(f); } else break;
    }
    return racha;
  }

  async function registrarEvidencia(event){
    event.preventDefault();
    const msg = document.getElementById('evidenceMsg');
    const shareRow = document.getElementById('evidenceShareRow');
    const descripcion = document.getElementById('evidenceDesc').value.trim();
    const enlace = document.getElementById('evidenceLink').value.trim();
    shareRow.innerHTML = '';
    if (!squadActual){ msg.textContent = 'Aún no tienes squad asignado.'; return false; }
    try{
      let verificadoGithub = null;
      if (githubUsuarioActual) verificadoGithub = await verificarActividadGithubHoy(githubUsuarioActual);
      await sb.from('evidence_logs').insert({
        squad_id: squadActual, user_id: sesionActual.id, descripcion, enlace: enlace || null,
        verificado_github: verificadoGithub
      });
      msg.className = 'modal-msg ok';
      msg.textContent = verificadoGithub === true
        ? 'Evidencia registrada. GitHub confirma actividad hoy ✓'
        : verificadoGithub === false
          ? 'Evidencia registrada. No se detectó push en GitHub hoy.'
          : 'Evidencia registrada. Actualizando racha...';

      const btnCompartir = document.createElement('button');
      btnCompartir.className = 'btn btn-ghost btn-sm';
      btnCompartir.textContent = 'Compartir en LinkedIn';
      btnCompartir.onclick = () => compartirEnLinkedIn(
        enlace || window.location.href,
        `Hoy en mi reto de 30 días con R.U.T. construí: ${descripcion} 🚀`,
        'evidenceShareStatus'
      );
      const estadoCompartir = document.createElement('span');
      estadoCompartir.id = 'evidenceShareStatus';
      estadoCompartir.className = 'editor-status';
      estadoCompartir.style.marginLeft = '10px';
      shareRow.appendChild(btnCompartir);
      shareRow.appendChild(estadoCompartir);

      document.getElementById('evidenceForm').reset();
      await cargarDashboard();
    } catch(err){
      msg.className = 'modal-msg err';
      msg.textContent = err.message || 'No se pudo registrar. Intenta de nuevo.';
    }
    return false;
  }

  // ---------- EDITOR COLABORATIVO (Supabase Realtime: broadcast + presence) ----------
  // Requiere una tabla `squad_editor_docs` (squad_id uuid PK/FK a squads, contenido text
  // default '', updated_at timestamptz default now()). Ver nota al inicio del archivo.
  let canalEditor = null;
  let editorEnfocado = false;
  let editorPendiente = null;
  let guardadoTimeout = null;
  let ultimoAutorId = null;

  function iniciales(nombre){
    return (nombre || '?').trim().split(/\s+/).slice(0,2).map(p => p[0]?.toUpperCase() || '').join('') || '?';
  }

  function pintarPresenciaEditor(estado){
    const cont = document.getElementById('editorPresence');
    cont.innerHTML = '';
    Object.values(estado).flat().forEach(p => {
      const span = document.createElement('span');
      span.className = 'presence-avatar';
      span.textContent = iniciales(p.nombre);
      span.title = p.nombre || 'Squad member';
      cont.appendChild(span);
    });
  }

  async function cargarContenidoEditor(squadId){
    try{
      const { data } = await sb.from('squad_editor_docs').select('contenido').eq('squad_id', squadId).maybeSingle();
      document.getElementById('editorTextarea').value = data?.contenido || '';
    } catch(err){
      console.warn('No se pudo cargar el editor colaborativo', err.message);
    }
  }

  function suscribirseAlEditor(squadId){
    if (canalEditor) sb.removeChannel(canalEditor);
    cargarContenidoEditor(squadId);
    const textarea = document.getElementById('editorTextarea');
    const estadoEl = document.getElementById('editorStatus');

    canalEditor = sb.channel(`editor-${squadId}`, { config: { presence: { key: sesionActual?.id || crypto.randomUUID() } } })
      .on('broadcast', { event: 'cambio' }, ({ payload }) => {
        if (!payload || payload.autor_id === sesionActual?.id) return;
        if (editorEnfocado){
          editorPendiente = payload.contenido;
        } else {
          textarea.value = payload.contenido;
        }
        ultimoAutorId = payload.autor_id;
      })
      .on('presence', { event: 'sync' }, () => pintarPresenciaEditor(canalEditor.presenceState()))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED'){
          await canalEditor.track({ nombre: nombreSesionActual() });
        }
      });

    textarea.oninput = () => onEditorInput(squadId);
    textarea.onfocus = () => { editorEnfocado = true; };
    textarea.onblur = () => {
      editorEnfocado = false;
      if (editorPendiente !== null){
        textarea.value = editorPendiente;
        editorPendiente = null;
      }
    };
    estadoEl.textContent = 'Guardado';
  }

  function nombreSesionActual(){
    return nombreActual;
  }

  function onEditorInput(squadId){
    const textarea = document.getElementById('editorTextarea');
    const contenido = textarea.value;
    document.getElementById('editorStatus').textContent = 'Escribiendo…';

    if (canalEditor){
      canalEditor.send({ type: 'broadcast', event: 'cambio', payload: { contenido, autor_id: sesionActual?.id } });
    }

    clearTimeout(guardadoTimeout);
    guardadoTimeout = setTimeout(() => guardarEditorEnDB(squadId, contenido), 900);
  }

  async function guardarEditorEnDB(squadId, contenido){
    const estadoEl = document.getElementById('editorStatus');
    try{
      await sb.from('squad_editor_docs').upsert({ squad_id: squadId, contenido, updated_at: new Date().toISOString() });
      estadoEl.textContent = 'Guardado';
    } catch(err){
      estadoEl.textContent = 'No se pudo guardar';
      console.warn('No se pudo guardar el editor colaborativo', err.message);
    }
  }

  // ---------- INTEGRACIÓN GITHUB (API pública, sin OAuth) ----------
  let githubUsuarioActual = null;

  async function verificarActividadGithubHoy(usuarioGithub){
    try{
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(usuarioGithub)}/events/public`);
      if (!res.ok) return null;
      const eventos = await res.json();
      const hoy = new Date().toISOString().slice(0,10);
      return eventos.some(e => e.type === 'PushEvent' && e.created_at.slice(0,10) === hoy);
    } catch(err){
      console.error('No se pudo consultar GitHub', err);
      return null;
    }
  }

  async function guardarYVerificarGithub(){
    const input = document.getElementById('githubUsuarioInput');
    const msg = document.getElementById('githubMsg');
    const usuario = input.value.trim().replace(/^@/, '');
    msg.className = 'modal-msg';
    if (!sesionActual){ msg.textContent = 'Inicia sesión primero para guardar tu usuario.'; msg.classList.add('err'); return; }
    if (!usuario){ msg.textContent = 'Escribe tu usuario de GitHub.'; msg.classList.add('err'); return; }
    msg.textContent = 'Verificando...';
    try{
      await sb.from('profiles').update({ github_usuario: usuario }).eq('id', sesionActual.id);
      githubUsuarioActual = usuario;
      const activo = await verificarActividadGithubHoy(usuario);
      if (activo === null){ msg.textContent = 'Guardado. No se pudo consultar GitHub ahora mismo.'; msg.classList.add('err'); }
      else if (activo){ msg.textContent = `Guardado. @${usuario} tiene actividad en GitHub hoy ✓`; msg.classList.add('ok'); }
      else { msg.textContent = `Guardado. @${usuario} no tiene push hoy todavía.`; msg.classList.add('ok'); }
    } catch(err){
      msg.textContent = err.message || 'No se pudo guardar tu usuario.'; msg.classList.add('err');
    }
  }

  // ---------- VIDEOLLAMADA (WebRTC nativo, señalización por Supabase Realtime) ----------
  // Malla completa (cada miembro se conecta con cada uno): funciona bien para squads
  // de 4. Sin tabla nueva en la base de datos, todo es señalización efímera por el
  // canal `call-{squadId}`. Solo usa un STUN público; en redes muy restrictivas
  // (ciertas redes corporativas) haría falta además un servidor TURN.
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  let canalLlamada = null;
  let localStream = null;
  let peerConnections = {};
  let enLlamada = false;
  let micActivo = true;
  let camActiva = true;
  let primeraSyncLlamada = true;

  function nombrePorIdLlamada(peerId){
    const estado = canalLlamada?.presenceState() || {};
    return estado[peerId]?.[0]?.nombre || 'Squad member';
  }

  function crearTileVideo(peerId, nombre, stream, esLocal){
    let tile = document.getElementById(`tile-${peerId}`);
    if (!tile){
      tile = document.createElement('div');
      tile.className = 'call-tile';
      tile.id = `tile-${peerId}`;
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true;
      if (esLocal) video.muted = true;
      const label = document.createElement('span');
      label.className = 'call-tile-name';
      label.textContent = esLocal ? 'Vos' : escaparHtml(nombre);
      tile.appendChild(video);
      tile.appendChild(label);
      document.getElementById('callGrid').appendChild(tile);
    }
    tile.querySelector('video').srcObject = stream;
  }

  function eliminarTileVideo(peerId){
    document.getElementById(`tile-${peerId}`)?.remove();
  }

  function crearPeerConnection(peerId){
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.onicecandidate = (e) => { if (e.candidate) enviarSenalLlamada('candidato', peerId, e.candidate); };
    pc.ontrack = (e) => crearTileVideo(peerId, nombrePorIdLlamada(peerId), e.streams[0], false);
    pc.onconnectionstatechange = () => {
      if (['disconnected','failed','closed'].includes(pc.connectionState)){
        cerrarConexionLlamada(peerId);
        eliminarTileVideo(peerId);
      }
    };
    peerConnections[peerId] = pc;
    return pc;
  }

  function cerrarConexionLlamada(peerId){
    peerConnections[peerId]?.close();
    delete peerConnections[peerId];
  }

  function enviarSenalLlamada(tipo, para, datos){
    canalLlamada?.send({ type:'broadcast', event:'señal', payload:{ tipo, de: sesionActual.id, para, datos } });
  }

  async function iniciarConexionHacia(peerId){
    const pc = crearPeerConnection(peerId);
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    enviarSenalLlamada('oferta', peerId, oferta);
  }

  async function manejarOfertaLlamada(peerId, oferta){
    const pc = crearPeerConnection(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(oferta));
    const respuesta = await pc.createAnswer();
    await pc.setLocalDescription(respuesta);
    enviarSenalLlamada('respuesta', peerId, respuesta);
  }

  function manejarSenalLlamada(payload){
    if (!payload || !sesionActual) return;
    if (payload.tipo === 'colgar'){
      cerrarConexionLlamada(payload.de);
      eliminarTileVideo(payload.de);
      return;
    }
    if (payload.para !== sesionActual.id) return;
    const peerId = payload.de;
    if (payload.tipo === 'oferta') manejarOfertaLlamada(peerId, payload.datos);
    else if (payload.tipo === 'respuesta') peerConnections[peerId]?.setRemoteDescription(new RTCSessionDescription(payload.datos));
    else if (payload.tipo === 'candidato' && payload.datos) peerConnections[peerId]?.addIceCandidate(new RTCIceCandidate(payload.datos)).catch(()=>{});
  }

  async function alternarLlamada(){
    if (enLlamada) await colgarLlamada(); else await iniciarLlamada();
  }

  async function iniciarLlamada(){
    if (!squadActual || !sesionActual) return;
    try{
      localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    } catch(err){
      alert('No se pudo acceder a la cámara o el micrófono: ' + err.message);
      return;
    }
    enLlamada = true;
    primeraSyncLlamada = true;
    document.getElementById('btnLlamada').textContent = 'Salir de la llamada';
    document.getElementById('callGrid').style.display = 'grid';
    document.getElementById('callControls').style.display = 'flex';
    crearTileVideo(sesionActual.id, 'Vos', localStream, true);

    canalLlamada = sb.channel(`call-${squadActual}`, { config: { presence: { key: sesionActual.id } } })
      .on('broadcast', { event:'señal' }, ({ payload }) => manejarSenalLlamada(payload))
      .on('presence', { event:'sync' }, () => {
        const ids = Object.keys(canalLlamada.presenceState()).filter(id => id !== sesionActual.id);
        if (primeraSyncLlamada){
          primeraSyncLlamada = false;
          ids.forEach(peerId => iniciarConexionHacia(peerId));
        }
        Object.keys(peerConnections).forEach(id => {
          if (!ids.includes(id)){ cerrarConexionLlamada(id); eliminarTileVideo(id); }
        });
      })
      .subscribe(async (status) => { if (status === 'SUBSCRIBED') await canalLlamada.track({ nombre: nombreActual }); });
  }

  async function colgarLlamada(){
    if (canalLlamada && sesionActual) enviarSenalLlamada('colgar', null, null);
    Object.keys(peerConnections).forEach(cerrarConexionLlamada);
    const grid = document.getElementById('callGrid');
    grid.innerHTML = '';
    grid.style.display = 'none';
    document.getElementById('callControls').style.display = 'none';
    document.getElementById('btnLlamada').textContent = 'Iniciar videollamada';
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    if (canalLlamada){ await canalLlamada.untrack(); sb.removeChannel(canalLlamada); canalLlamada = null; }
    enLlamada = false;
  }

  function alternarMic(){
    if (!localStream) return;
    micActivo = !micActivo;
    localStream.getAudioTracks().forEach(t => t.enabled = micActivo);
    const btn = document.getElementById('btnMic');
    btn.classList.toggle('off', !micActivo);
    btn.textContent = micActivo ? '🎤' : '🔇';
    btn.setAttribute('aria-label', micActivo ? 'Silenciar micrófono' : 'Activar micrófono');
  }

  function alternarCam(){
    if (!localStream) return;
    camActiva = !camActiva;
    localStream.getVideoTracks().forEach(t => t.enabled = camActiva);
    const btn = document.getElementById('btnCam');
    btn.classList.toggle('off', !camActiva);
    btn.textContent = camActiva ? '📷' : '🚫';
    btn.setAttribute('aria-label', camActiva ? 'Apagar cámara' : 'Encender cámara');
  }

  window.addEventListener('beforeunload', () => {
    if (enLlamada && canalLlamada && sesionActual) enviarSenalLlamada('colgar', null, null);
  });

  // ---------- INTEGRACIÓN LINKEDIN (share-offsite, sin OAuth) ----------
  // LinkedIn no permite precargar el texto del post vía URL (solo el link, que luego
  // resuelve con sus propias meta-tags). Como workaround real, copiamos al portapapeles
  // un texto sugerido para que la persona lo pegue directo en su post.
  async function compartirEnLinkedIn(url, textoSugerido, statusElId){
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    let copiado = false;
    try{
      if (textoSugerido && navigator.clipboard){ await navigator.clipboard.writeText(textoSugerido); copiado = true; }
    } catch(err){ console.warn('No se pudo copiar el texto sugerido', err); }
    window.open(shareUrl, '_blank', 'noopener,width=600,height=600');
    if (statusElId){
      const el = document.getElementById(statusElId);
      if (el) el.textContent = copiado ? 'Se abrió LinkedIn — pega el texto que copiamos en tu post.' : 'Se abrió LinkedIn para compartir.';
    }
  }

  // ---------- RUTA DE LECCIONES (motor propio, estilo Duolingo) ----------
  const MATERIAS = {
    programacion: { nombre:'Programación', lecciones:[
      { id:'prog-1', titulo:'Variables', preguntas:[
        { texto:'¿Qué guarda una variable?', opciones:['Un valor que puede cambiar','Solo texto','Nada, se borra sola','Un archivo'], correcta:0 },
        { texto:'En JavaScript, ¿cuál declara una variable?', opciones:['var x','int x','dim x','variable x'], correcta:0 },
        { texto:'let x = 5; x = x + 1; console.log(x); ¿Qué imprime?', opciones:['5','6','error','x+1'], correcta:1 },
      ]},
      { id:'prog-2', titulo:'Funciones', preguntas:[
        { texto:'¿Para qué sirve una función?', opciones:['Agrupar código reutilizable','Borrar variables','Cambiar el color de la página','Nada'], correcta:0 },
        { texto:'¿Cómo se llama a una función llamada saludar()?', opciones:['saludar[]','call saludar','saludar()','run saludar'], correcta:2 },
        { texto:"¿Qué devuelve una función sin 'return'?", opciones:['undefined','0','null','error'], correcta:0 },
      ]},
    ]},
    cocina: { nombre:'Cocina', lecciones:[
      { id:'cocina-1', titulo:'Técnicas base', preguntas:[
        { texto:"¿Qué es 'saltear'?", opciones:['Cocinar rápido a fuego alto con poco aceite','Hervir por horas','Congelar','Hornear a baja temperatura'], correcta:0 },
        { texto:'¿Punto de ebullición del agua a nivel del mar?', opciones:['90°C','100°C','120°C','80°C'], correcta:1 },
        { texto:"¿Qué significa 'mise en place'?", opciones:['Tener todo listo antes de cocinar','Un tipo de horno','Lavar platos','Un corte de verdura'], correcta:0 },
      ]},
      { id:'cocina-2', titulo:'Sabores', preguntas:[
        { texto:'¿Cuáles son los 5 sabores básicos?', opciones:['Dulce, salado, ácido, amargo, umami','Solo dulce y salado','Picante, dulce, frío','Ninguno'], correcta:0 },
        { texto:'¿Qué hace la sal en un platillo dulce como caramelo?', opciones:['Resalta el dulzor','Lo arruina siempre','Nada','Lo hace amargo'], correcta:0 },
      ]},
    ]},
    ventas: { nombre:'Ventas', lecciones:[
      { id:'ventas-1', titulo:'Fundamentos', preguntas:[
        { texto:"¿Qué es un 'lead'?", opciones:['Un contacto con potencial de compra','Un producto','Una factura','Un descuento'], correcta:0 },
        { texto:"¿Qué significa 'cerrar una venta'?", opciones:['Conseguir que el cliente confirme la compra','Cerrar la tienda','Cancelar el pedido','Bajar el precio'], correcta:0 },
        { texto:'¿Cuál es una objeción común de un cliente?', opciones:["'Está muy caro'","'Me encanta'","'Lo compro ya'","'Recomiéndalo'"], correcta:0 },
      ]},
    ]},
    marketing: { nombre:'Marketing', lecciones:[
      { id:'mkt-1', titulo:'Fundamentos', preguntas:[
        { texto:'¿Qué son las 4P del marketing?', opciones:['Producto, Precio, Plaza, Promoción','Papel, Pluma, Pizarra, Presupuesto','Persona, Producto, Precio, Plan','Ninguna'], correcta:0 },
        { texto:"¿Qué mide el 'engagement' en redes sociales?", opciones:['Interacción de la audiencia con el contenido','El número de empleados','El precio del producto','Nada'], correcta:0 },
      ]},
    ]},
  };

  let materiaActiva = 'programacion';
  let progresoLecciones = new Set();
  let xpTotal = 0;
  let leccionEnCurso = null;
  let vidas = 5;
  let preguntaIdx = 0;

  function renderMateriaTabs(){
    const cont = document.getElementById('materiaTabs');
    cont.innerHTML = '';
    Object.entries(MATERIAS).forEach(([key, m]) => {
      const btn = document.createElement('button');
      btn.className = 'materia-tab' + (key === materiaActiva ? ' active' : '');
      btn.textContent = m.nombre;
      btn.onclick = () => { materiaActiva = key; renderMateriaTabs(); renderLeccionPath(); };
      cont.appendChild(btn);
    });
  }

  function renderLeccionPath(){
    const cont = document.getElementById('leccionPath');
    cont.innerHTML = '';
    const lecciones = MATERIAS[materiaActiva].lecciones;
    lecciones.forEach((lec, i) => {
      const previaCompleta = i === 0 || progresoLecciones.has(lecciones[i-1].id);
      const completa = progresoLecciones.has(lec.id);
      const div = document.createElement('div');
      div.className = 'leccion-nodo' + (completa ? ' done' : '') + (!previaCompleta ? ' locked' : '');
      div.innerHTML = `${completa ? '✓' : (i+1)}<span>${lec.titulo}</span>`;
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', `${lec.titulo}${completa ? ' — completada' : ''}${!previaCompleta ? ' — bloqueada, completa la anterior primero' : ''}`);
      if (previaCompleta){
        div.tabIndex = 0;
        div.onclick = () => abrirLeccion(lec);
        div.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); abrirLeccion(lec); } };
      } else {
        div.tabIndex = -1;
        div.setAttribute('aria-disabled', 'true');
      }
      cont.appendChild(div);
    });
  }

  function abrirLeccion(leccion){
    leccionEnCurso = leccion; preguntaIdx = 0; vidas = 5;
    document.getElementById('playerBg').classList.add('open');
    mostrarPregunta();
  }

  function cerrarLeccion(){
    document.getElementById('playerBg').classList.remove('open');
    leccionEnCurso = null;
  }

  function renderCorazones(){
    const cont = document.getElementById('heartsDisplay');
    cont.innerHTML = '';
    for (let i = 0; i < 5; i++){
      const s = document.createElement('span');
      s.className = 'heart' + (i >= vidas ? ' lost' : '');
      s.textContent = '♥';
      cont.appendChild(s);
    }
  }

  function mostrarPregunta(){
    renderCorazones();
    if (vidas <= 0){
      document.getElementById('preguntaTexto').textContent = 'Se acabaron las vidas. Intenta de nuevo.';
      document.getElementById('opcionesContainer').innerHTML = `<button class="btn btn-primary" style="width:100%;" onclick="abrirLeccion(leccionEnCurso)">Reintentar</button>`;
      return;
    }
    if (preguntaIdx >= leccionEnCurso.preguntas.length){ completarLeccion(); return; }
    const q = leccionEnCurso.preguntas[preguntaIdx];
    document.getElementById('preguntaTexto').textContent = q.texto;
    const cont = document.getElementById('opcionesContainer');
    cont.innerHTML = '';
    q.opciones.forEach((op, i) => {
      const btn = document.createElement('button');
      btn.className = 'opcion';
      btn.textContent = op;
      btn.onclick = () => responder(i, q.correcta, btn);
      cont.appendChild(btn);
    });
  }

  function responder(elegida, correcta, btnEl){
    document.querySelectorAll('#opcionesContainer .opcion').forEach(o => o.onclick = null);
    if (elegida === correcta){
      btnEl.classList.add('correcta');
      setTimeout(() => { preguntaIdx++; mostrarPregunta(); }, 500);
    } else {
      btnEl.classList.add('incorrecta');
      document.querySelectorAll('#opcionesContainer .opcion')[correcta].classList.add('correcta');
      vidas--;
      setTimeout(() => { preguntaIdx++; mostrarPregunta(); }, 700);
    }
  }

  async function completarLeccion(){
    document.getElementById('preguntaTexto').textContent = '¡Lección completada!';
    const cont = document.getElementById('opcionesContainer');
    cont.innerHTML = '';
    const btnContinuar = document.createElement('button');
    btnContinuar.className = 'btn btn-primary';
    btnContinuar.style.width = '100%';
    btnContinuar.textContent = 'Continuar';
    btnContinuar.onclick = cerrarLeccion;
    const btnCompartir = document.createElement('button');
    btnCompartir.className = 'btn btn-ghost';
    btnCompartir.style.cssText = 'width:100%; justify-content:center; margin-top:10px;';
    btnCompartir.textContent = 'Compartir en LinkedIn';
    const tituloLeccion = leccionEnCurso.titulo;
    btnCompartir.onclick = () => compartirEnLinkedIn(
      window.location.href,
      `Terminé la lección "${tituloLeccion}" en R.U.T. y ya llevo ${xpTotal} XP en mi reto de 30 días. 💪`,
      null
    );
    cont.appendChild(btnContinuar);
    cont.appendChild(btnCompartir);
    if (!progresoLecciones.has(leccionEnCurso.id)){
      progresoLecciones.add(leccionEnCurso.id);
      xpTotal += 20;
      actualizarStatsLecciones();
      if (sesionActual){
        try{
          await sb.from('lesson_progress').insert({ user_id: sesionActual.id, leccion_id: leccionEnCurso.id });
          await sb.from('profiles').update({ xp_total: xpTotal }).eq('id', sesionActual.id);
        } catch(err){ console.warn('No se pudo guardar el progreso', err.message); }
      }
    }
    renderLeccionPath();
  }

  function actualizarStatsLecciones(){
    document.getElementById('xpTotalDisplay').textContent = xpTotal;
    document.getElementById('leccionesCompletadasDisplay').textContent = progresoLecciones.size;
  }

  async function cargarProgresoLecciones(){
    if (!sesionActual) return;
    try{
      const { data: perfil } = await sb.from('profiles').select('xp_total').eq('id', sesionActual.id).maybeSingle();
      xpTotal = perfil?.xp_total || 0;
      const { data: progreso } = await sb.from('lesson_progress').select('leccion_id').eq('user_id', sesionActual.id);
      progresoLecciones = new Set((progreso||[]).map(p => p.leccion_id));
    } catch(err){ console.warn('Supabase no configurado todavía.', err.message); }
    actualizarStatsLecciones();
    renderLeccionPath();
  }

  renderMateriaTabs();
  renderLeccionPath();

  // ---------- EMPLEABILIDAD: checklist de LinkedIn + bolsa de empleo ----------
  // MVP: guarda el checklist y la URL de LinkedIn en la tabla `profiles`
  // (columnas nuevas: linkedin_checklist jsonb, linkedin_url text). Sin sesión
  // iniciada, usa localStorage para que la persona pueda probarlo igual.
  // LECCIONES_REQUERIDAS y CHECKLIST_PCT_REQUERIDO controlan cuándo se
  // desbloquean las vacantes; EMPRESAS es la lista de empresas aliadas —
  // reemplázala por tus convenios reales antes de publicar.
  const LECCIONES_REQUERIDAS = 4;
  const CHECKLIST_PCT_REQUERIDO = 70;

  const LINKEDIN_CHECKLIST = [
    { id:'foto', texto:'Foto de perfil profesional', tip:'Rostro visible, buena luz, fondo neutro — sin selfies ni logos.' },
    { id:'titular', texto:'Titular con palabras clave del rol que buscas', tip:'Ej: "Desarrollador Frontend Jr. · HTML, CSS, JS" en vez de solo "Estudiante".' },
    { id:'extracto', texto:'Sección "Acerca de" con tu historia y objetivo', tip:'3-5 líneas: qué sabes hacer, qué buscas y un dato que te distinga.' },
    { id:'experiencia', texto:'Experiencia con logros medibles', tip:'Cambia "Encargado de tareas" por resultados: "Reduje el tiempo de carga en 30%".' },
    { id:'portafolio', texto:'Proyecto de R.U.T. agregado como proyecto o publicación', tip:'Enlaza tu repo o el deploy de tu proyecto del squad.' },
    { id:'habilidades', texto:'Habilidades técnicas listadas y ordenadas por relevancia', tip:'Pon primero las que pide la vacante a la que apuntas.' },
    { id:'certificados', texto:'Certificados de tus cursos agregados a la sección de Licencias', tip:'Sube los certificados de Coddy y de tus lecciones completadas en R.U.T.' },
    { id:'url', texto:'URL personalizada de tu perfil', tip:'linkedin.com/in/tu-nombre en vez de una URL con números.' },
    { id:'recomendaciones', texto:'Al menos 1 recomendación o validación de habilidades', tip:'Pide una a alguien de tu squad que haya visto tu trabajo.' },
  ];

  // EMPRESAS ALIADAS — placeholder de ejemplo. Sustituye por tus convenios reales
  // (nombre, rol, cursosRequeridos y url de postulación) antes de publicar el sitio.
  const EMPRESAS = [
    { nombre:'Estudio Web Local (ejemplo)', rol:'Frontend Jr. — práctica remunerada', cursosRequeridos:2, url:'#' },
    { nombre:'Agencia Digital Aliada (ejemplo)', rol:'Soporte técnico / QA Jr.', cursosRequeridos:3, url:'#' },
    { nombre:'Startup Guatemala (ejemplo)', rol:'Desarrollador Frontend Jr.', cursosRequeridos:4, url:'#' },
  ];

  let liChecklistCompletado = new Set();
  let liUrl = '';

  function renderLiChecklist(){
    const cont = document.getElementById('liChecklist');
    cont.innerHTML = '';
    LINKEDIN_CHECKLIST.forEach(item => {
      const completo = liChecklistCompletado.has(item.id);
      const li = document.createElement('li');
      li.className = 'li-item' + (completo ? ' done' : '');
      li.innerHTML = `
        <span class="li-check">${completo ? '✓' : ''}</span>
        <div class="li-item-body"><strong>${escaparHtml(item.texto)}</strong><span>${escaparHtml(item.tip)}</span></div>`;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.setAttribute('aria-pressed', completo ? 'true' : 'false');
      li.onclick = () => toggleLiItem(item.id);
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleLiItem(item.id); } };
      cont.appendChild(li);
    });
    actualizarProgresoLi();
  }

  function actualizarProgresoLi(){
    const total = LINKEDIN_CHECKLIST.length;
    const completos = liChecklistCompletado.size;
    const pct = total ? Math.round((completos / total) * 100) : 0;
    document.getElementById('liResumen').textContent = `${completos} de ${total} puntos corregidos.`;
    const circ = 163.4;
    document.getElementById('liRingCircle').style.strokeDashoffset = circ - (circ * pct / 100);
    document.getElementById('liRingNum').textContent = `${pct}%`;
    return pct;
  }

  async function toggleLiItem(id){
    if (liChecklistCompletado.has(id)) liChecklistCompletado.delete(id);
    else liChecklistCompletado.add(id);
    renderLiChecklist();
    renderEmpresas();
    await guardarEmpleabilidad();
  }

  async function guardarLinkedInUrl(){
    liUrl = document.getElementById('liUrlInput').value.trim();
    await guardarEmpleabilidad();
  }

  async function guardarEmpleabilidad(){
    const payload = { linkedin_checklist: Array.from(liChecklistCompletado), linkedin_url: liUrl || null };
    if (sesionActual){
      try{ await sb.from('profiles').update(payload).eq('id', sesionActual.id); }
      catch(err){ console.warn('No se pudo guardar tu progreso de LinkedIn.', err.message); }
    } else {
      try{ localStorage.setItem('rut_empleabilidad', JSON.stringify(payload)); } catch(err){}
    }
  }

  async function cargarEmpleabilidad(){
    if (sesionActual){
      try{
        const { data } = await sb.from('profiles').select('linkedin_checklist, linkedin_url').eq('id', sesionActual.id).maybeSingle();
        liChecklistCompletado = new Set(data?.linkedin_checklist || []);
        liUrl = data?.linkedin_url || '';
      } catch(err){ console.warn('Supabase no configurado todavía.', err.message); }
    } else {
      try{
        const guardado = JSON.parse(localStorage.getItem('rut_empleabilidad') || '{}');
        liChecklistCompletado = new Set(guardado.linkedin_checklist || []);
        liUrl = guardado.linkedin_url || '';
      } catch(err){}
    }
    document.getElementById('liUrlInput').value = liUrl;
    renderLiChecklist();
    renderEmpresas();
  }

  function renderEmpresas(){
    const pctLi = actualizarProgresoLi();
    const leccionesHechas = progresoLecciones.size;
    const faltanLecciones = Math.max(0, LECCIONES_REQUERIDAS - leccionesHechas);
    const reqPct = Math.min(100, Math.round(
      ((Math.min(leccionesHechas, LECCIONES_REQUERIDAS) / LECCIONES_REQUERIDAS) * 50) +
      ((Math.min(pctLi, CHECKLIST_PCT_REQUERIDO) / CHECKLIST_PCT_REQUERIDO) * 50)
    ));
    document.getElementById('reqBarFill').style.width = reqPct + '%';
    document.getElementById('reqLeccionesFaltan').textContent = faltanLecciones > 0 ? faltanLecciones : 0;
    document.getElementById('reqNota').innerHTML = faltanLecciones > 0
      ? `Completa <strong>${faltanLecciones} lección(es)</strong> más y el ${CHECKLIST_PCT_REQUERIDO}% del checklist de LinkedIn para postularte con empresas aliadas.`
      : `Ya cumples las lecciones mínimas. Llega al ${CHECKLIST_PCT_REQUERIDO}% del checklist de LinkedIn para desbloquear todas las vacantes.`;

    const cont = document.getElementById('empresasLista');
    cont.innerHTML = '';
    EMPRESAS.forEach(emp => {
      const desbloqueada = leccionesHechas >= emp.cursosRequeridos && pctLi >= CHECKLIST_PCT_REQUERIDO;
      const div = document.createElement('div');
      div.className = 'empresa-card' + (desbloqueada ? '' : ' locked');
      div.innerHTML = `
        <div class="empresa-top">
          <div>
            <h4>${escaparHtml(emp.nombre)}</h4>
            <p class="empresa-rol">${escaparHtml(emp.rol)}</p>
          </div>
          ${desbloqueada ? '' : `<span class="lock-tag">🔒 ${emp.cursosRequeridos} lecciones</span>`}
        </div>
        <span class="empresa-req">${desbloqueada ? 'Vacante desbloqueada' : `Requiere ${emp.cursosRequeridos} lecciones completadas + ${CHECKLIST_PCT_REQUERIDO}% de LinkedIn`}</span>
        <a class="btn ${desbloqueada ? 'btn-primary' : 'btn-ghost'} btn-sm" style="align-self:flex-start; margin-top:6px;" ${desbloqueada ? `href="${emp.url}" target="_blank" rel="noopener"` : ''}>${desbloqueada ? 'Postularme' : 'Bloqueada'}</a>`;
      cont.appendChild(div);
    });
  }

  // ---------- INIT ----------
  (async function init(){
    try{
      const { data } = await sb.auth.getSession();
      if (data?.session?.user){
        sesionActual = data.session.user;
        await cargarDashboard();
      }
    } catch(err){
      console.warn('Supabase no configurado todavía.', err.message);
    }
    await cargarEmpleabilidad();
  })();