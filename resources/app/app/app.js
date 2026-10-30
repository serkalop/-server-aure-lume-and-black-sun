(function(){
'use strict';

var PAGE_QUERY = {
  'index':'index',
  'play':'play',
  'store':'store',
  'server':'server',
  'team':'team',
  'profile':'profile',
  'misc':'misc'
};

var products = [
  ['Разбан', 100, '🛡️'],
  ['Hero', 40, '⚔️'],
  ['Titan', 90, '💎'],
  ['Dragon', 1900, '🐉'],
  ['Helper', 6666, '🧪'],
  ['Avenger', 130, '🏹'],
  ['Magister', 590, '🔮'],
  ['Размут', 25, '🔊'],
  ['Overlord', 290, '👑'],
  ['Imperator', 999, '🐯']
];

var SHOP_URL = 'https://playmyrealserver9.webtm.ru/';

function $(id){ return document.getElementById(id); }

/* ---------- toast ---------- */
function toast(message){
  var t = $('toast');
  if(!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(function(){
    t.classList.remove('show');
  }, 2400);
}

/* ---------- navigation (multi-page) ---------- */
function goPage(page){
  if(PAGE_QUERY[page]){
    window.location.href = page + '.html';
  }
}

function bindNav(){
  document.querySelectorAll('[data-page]').forEach(function(btn){
    btn.addEventListener('click', function(){
      goPage(btn.getAttribute('data-page'));
    });
  });
}

/* ---------- copy ---------- */
function copyText(text, label){
  try {
    if(window.__electronCopy && typeof window.__electronCopy === 'function'){
      window.__electronCopy(text, label);
      return;
    }
  } catch(e){}
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      toast(label || 'Скопировано');
    }).catch(function(){
      toast(label || text);
    });
  } else {
    toast(label || text);
  }
}

function bindCopy(){
  document.querySelectorAll('[data-copy]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var value = btn.getAttribute('data-copy');
      var label = btn.getAttribute('data-copy-label') ||
        'Скопировано: ' + value;
      copyText(value, label);
    });
  });

  var coupon = $('copyCoupon');
  if(coupon){
    coupon.addEventListener('click', function(){
      copyText('one_GAME', 'Промокод скопирован');
    });
  }
}

/* ---------- payment layer ---------- */
function openShop(name){
  recordHistory(name || 'Магазин TradeMC');
  var form = document.getElementById('trademc-buyform');
  if(form){
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Форма покупки — выше');
    return;
  }
  if(window.__openShop && typeof window.__openShop === 'function'){
    window.__openShop(name);
    return;
  }
  window.open(SHOP_URL, '_blank', 'noopener,noreferrer');
  toast('Переход на сайт магазина');
}

function bindOpenShop(){
  var btn = $('openShop');
  if(btn){
    btn.addEventListener('click', function(){
      openShop('Магазин TradeMC');
    });
  }
}

/* ---------- launch Minecraft (via Electron build) ---------- */
var launchState = null;
var GAME_VERSION = '1.21.1'; // перезаписывается версией из конфига установщика (game-config.js)

function setStatus(text, isError){
  var status = $('launchStatus');
  var err = $('gamePathError');
  if(status){ status.textContent = text; status.style.color = isError ? 'var(--danger)' : ''; }
  if(err){ err.textContent = isError ? text : ''; }
}

function fillVersions(versions, selected){
  var sel = $('versionSelect');
  if(!sel) return;
  sel.replaceChildren();
  var sorted = versions.slice().sort(function(a,b){
    return b.localeCompare(a, undefined, {numeric:true});
  });
  if(!sorted.length){
    var o = document.createElement('option');
    o.value = ''; o.textContent = 'Нет установленных версий';
    sel.appendChild(o);
    return;
  }
  sorted.forEach(function(v){
    var o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  var prefer = selected && sorted.indexOf(selected) !== -1 ? selected : (sorted.indexOf(GAME_VERSION)!==-1?GAME_VERSION:sorted[0]);
  sel.value = prefer;
}

function renderDetectState(st){
  var p = $('gamePathStatus');
  var launchPanel = $('launchPanel');
  var installPanel = $('installPanel');
  var disableLaunch = !st.gamesDir && !st.autoFound;

  if(p){
    if(st.gamesDir || st.autoFound){
      p.textContent = 'Minecraft установлен и готов к запуску.';
      p.style.color = '';
    } else {
      p.textContent = 'Игра не найдена на этом компьютере.';
      p.style.color = 'var(--danger)';
    }
  }

  // показываем панель установки, если игры нет
  if(installPanel) installPanel.hidden = !disableLaunch;
  if(launchPanel && disableLaunch) launchPanel.style.display = 'none';
  if(launchPanel && !disableLaunch) launchPanel.style.display = '';

  // кнопка запуска доступна только если игра есть
  var launch = $('launch');
  if(launch) launch.disabled = disableLaunch;

  if(disableLaunch && p){
    var e = $('gamePathError');
    if(e) e.textContent = 'Установите Minecraft кнопкой ниже, чтобы начать играть.';
  }
}

function installMinecraft(){
  var api = window.LordOfTheGamesAPI;
  if(!api || typeof api.installMinecraft !== 'function'){ toast('Установка доступна в настольном приложении'); return; }

  var version = GAME_VERSION;

  var ok = confirm(
    'Установить Minecraft ' + version + '?\n' +
    'Будет скачано из официальных источников Mojang ' +
    'около 1.5–2 ГБ (игра, библиотеки, ассеты, Java при необходимости).\n' +
    'Это может занять несколько минут. Не закрывай приложение во время установки.\n\n' +
    'Продолжить?'
  );
  if(!ok) return;

  var wrap = $('installProgressWrap');
  var bar = $('installProgressBar');
  var status = $('installStatus');
  var btn = $('installBtn');
  if(wrap) wrap.hidden = false;
  if(btn) btn.disabled = true;
  if(status) status.textContent = 'Начинаю установку…';
  if(bar) bar.style.width = '0%';

  api.onInstallProgress && api.onInstallProgress(function(pg){
    if(!pg) return;
    if(bar) bar.style.width = (pg.frac || 0) + '%';
    if(status) status.textContent = pg.message || '';
  });

  api.installMinecraft(JSON.stringify({ version: version })).then(function(res){
    if(res && res.ok){
      if(status) status.textContent = 'Minecraft ' + version + ' установлен.';
      toast('Minecraft установлен');
      loadLaunchState();
    } else {
      var msg = (res && res.error) ? res.error : 'Не удалось установить';
      if(status){ status.textContent = 'Ошибка: ' + msg; status.style.color = 'var(--danger)'; }
      toast(msg);
      if(btn) btn.disabled = false;
    }
  });
}

function updateVersionLabels(){
  var v = GAME_VERSION;
  var t = $('installTitle'); if(t) t.textContent = 'Установить Minecraft ' + v;
  var s = $('installSub'); if(s) s.textContent = 'Игра не найдена. Лаунчер скачает и установит Minecraft ' + v + ' из официальных источников Mojang (~1.5–2 ГБ). Не закрывай приложение во время установки.';
  var b = $('installBtnLabel'); if(b) b.textContent = '▶ Установить Minecraft ' + v;
}

function loadLaunchState(){
  var api = window.LordOfTheGamesAPI;
  if(!api || typeof api.getLaunchState !== 'function') return;
  api.getLaunchState().then(function(st){
    if(!st) return;
    launchState = st;
    if(st.configVersion) GAME_VERSION = st.configVersion;
    updateVersionLabels();
    renderDetectState(st);
  }).catch(function(){});
}

function launchLauncher(){
  var api = window.LordOfTheGamesAPI;
  var version = GAME_VERSION;

  // Ник всегда берётся из личного кабинета. Вход в кабинет обязателен.
  if(!authState || !authState.user){
    setStatus('Для запуска войдите в личный кабинет.', true);
    toast('Сначала войдите в личный кабинет');
    if(window.LordOfTheGames && window.LordOfTheGames.goPage){
      setTimeout(function(){ window.LordOfTheGames.goPage('profile'); }, 1200);
    }
    return;
  }
  var nick = (authState.user.username || '').trim() || 'Steve';

  if(!api || typeof api.launchMinecraft !== 'function'){
    setStatus('Запуск доступен только в настольном приложении.');
    return;
  }

  var payload = { nick: nick, version: version };
  if(launchState && launchState.gamesDir) payload.gamesDir = launchState.gamesDir;
  payload.version = version;

  setStatus('Запускаю Minecraft ' + version + '…');
  api.launchMinecraft(JSON.stringify(payload)).then(function(result){
    if(result && result.ok){
      setStatus('Minecraft ' + (result.version || version) + ' запущен с ником ' + nick);
      toast('Minecraft запущен');
    } else {
      var msg = (result && result.error) ? result.error : 'Не удалось запустить Minecraft';
      setStatus(msg, true);
      toast(msg);
    }
  }).catch(function(err){
    setStatus('Ошибка запуска: ' + err, true);
  });
}

function saveQuickNick(){
  var input = $('nickFast');
  if(!input) return;
  var nick = input.value.trim();
  if(!/^[A-Za-z0-9_]{3,16}$/.test(nick)){
    toast('Ник: 3–16 латинских букв, цифр или _');
    return;
  }
  state.nick = nick;
  saveState();
  renderProfile();
  input.value = nick;
  toast('Ник сохранён: ' + nick);
}

function bindPlay(){
  var launch = $('launch');
  if(launch) launch.addEventListener('click', launchLauncher);

  var saveNick = $('saveNick');
  var nickFast = $('nickFast');
  if(saveNick && nickFast){
    saveNick.addEventListener('click', saveQuickNick);
    nickFast.addEventListener('keydown', function(e){
      if(e.key === 'Enter') saveQuickNick();
    });
  }

  var installBtn = $('installBtn');
  if(installBtn) installBtn.addEventListener('click', installMinecraft);

  var reDetect = $('reDetect');
  if(reDetect) reDetect.addEventListener('click', loadLaunchState);
}

/* ---------- store catalog ---------- */
function priceOf(array){ return Number(String(array[1]).replace(/,/g,'')) || 0; }

function renderProducts(){
  var q = $('search');
  var s = $('sort');
  var cards = $('cards');
  var empty = $('empty');
  if(!cards) return;

  var query = (q ? q.value : '').trim().toLowerCase();
  var sort = s ? s.value : 'default';

  var list = products.filter(function(p){
    return p[0].toLowerCase().indexOf(query) !== -1;
  });

  if(sort === 'asc'){
    list.sort(function(a,b){ return priceOf(a) - priceOf(b); });
  } else if(sort === 'desc'){
    list.sort(function(a,b){ return priceOf(b) - priceOf(a); });
  }

  cards.replaceChildren();
  list.forEach(function(p){
    var el = document.createElement('article');
    el.className = 'product';

    var art = document.createElement('div');
    art.className = 'art';
    art.textContent = p[2];

    var name = document.createElement('b');
    name.textContent = p[0];

    var price = document.createElement('div');
    price.className = 'price';
    price.textContent = p[1] + ' ₽';

    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Купить';
    btn.addEventListener('click', function(){
      recordHistory(p[0]);
      var form = document.getElementById('trademc-buyform');
      // Предвыбрать привилегию в форме TradeMC
      if(window.__selectTradeItem && typeof window.__selectTradeItem === 'function'){
        var ok = window.__selectTradeItem(p[0]);
        if(form){
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          toast(ok ? 'Выбрано: ' + p[0] : 'Открой форму и выбери товар вручную');
        } else {
          toast(ok ? 'Выбрано: ' + p[0] : 'Форма покупки — выше');
        }
        return;
      }
      if(window.__buy && typeof window.__buy === 'function'){
        window.__buy(p[0], p[1]);
      } else {
        openShop(p[0]);
      }
    });

    el.appendChild(art);
    el.appendChild(name);
    el.appendChild(price);
    el.appendChild(btn);
    cards.appendChild(el);
  });

  if(empty){
    empty.hidden = list.length > 0;
  }
}

function bindStore(){
  var search = $('search');
  var sort = $('sort');
  if(search) search.addEventListener('input', renderProducts);
  if(sort) sort.addEventListener('change', renderProducts);
  if(search || sort) renderProducts();
}

/* ---------- server auth (login/password from site) ---------- */
var authState = { user: null, checking: true };

function authApi(){
  return window.LordOfTheGamesAPI || null;
}

function authError(el, msg){
  el = el || $('authErr');
  if(el){ el.textContent = msg || ''; el.style.color = 'var(--danger)'; }
}

function authRender(){
  var guest = $('authGuest');
  var authed = $('authAuthed');
  if(!guest && !authed) return;
  if(guest) guest.hidden = !!authState.user;
  if(authed) authed.hidden = !authState.user;
  if(authState.user){
    $('authName').textContent = authState.user.username;
    var iconBox = $('authIconShow');
    if(iconBox){
      // если есть картинка аватара — показываем её, иначе эмодзи
      if(authState.user.avatar){
        iconBox.innerHTML = '<img src="' + authState.user.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">';
      } else {
        iconBox.innerHTML = authState.user.icon || '👑';
        iconBox.style.display = '';
      }
    }
    var sel = $('authIcon');
    if(sel) sel.value = authState.user.icon || '👑';
  }
  $('profileStatus') && ($('profileStatus').textContent =
    authState.user ? 'Аккаунт сайта: ' + authState.user.username : 'Локальный профиль');
}

function authCheck(){
  var api = authApi();
  if(!api || typeof api.authMe !== 'function'){
    authState.checking = false;
    authRender();
    return;
  }
  api.authMe().then(function(res){
    authState.checking = false;
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      state.nick = res.body.user.username;
      state.icon = res.body.user.icon && ['⛏️','🧱','⚔️','💎','🌲'].indexOf(res.body.user.icon)!==-1 ? res.body.user.icon : '⛏️';
    } else {
      authState.user = null;
    }
    saveState();
    renderProfile();
    authRender();
  }).catch(function(){
    authState.checking = false;
    authState.user = null;
    authRender();
  });
}

function doAuthLogin(){
  var u = $('authUser'), p = $('authPass'), err = $('authErr');
  var api = authApi();
  if(!api){ authError(err, 'Приложение не запущено как настольное.'); return; }
  var username = u ? u.value.trim() : '';
  var password = p ? p.value : '';
  if(!username || !password){ authError(err, 'Введите логин и пароль.'); return; }
  api.authLogin(JSON.stringify({ username: username, password: password })).then(function(res){
    // 2FA: TG привязан — сервер просит подтвердить вход в Telegram (status 202)
    if(res && res.status === 202 && res.body && res.body.need_tg_confirm){
      var lt = res.body.login_token;
      if(lt){
        authError(err, 'Подтвердите вход в Telegram…');
        pollTgConfirm(lt, err);
        return;
      }
    }
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      state.nick = res.body.user.username;
      state.icon = res.body.user.icon && ['⛏️','🧱','⚔️','💎','🌲'].indexOf(res.body.user.icon)!==-1 ? res.body.user.icon : '⛏️';
      saveState(); renderProfile(); authRender();
      toast('Вход выполнен: ' + res.body.user.username);
    } else {
      authError(err, (res && res.body && res.body.message) ? res.body.message : 'Неверный логин или пароль.');
    }
  });
}

// Поллинг статуса подтверждения входа в TG (2FA) и получение токена
function pollTgConfirm(loginToken, err){
  var api = authApi();
  if(!api || typeof api.authTgConfirmStatus !== 'function') return;
  var attempts = 0;
  var timer = setInterval(function(){
    attempts++;
    if(attempts > 120){ clearInterval(timer); authError(err, 'Время ожидания подтверждения истекло.'); return; }
    api.authTgConfirmStatus(JSON.stringify({ login_token: loginToken })).then(function(res){
      if(!res) return;
      var status = res.body && res.body.status;
      if(status === 'confirmed'){
        clearInterval(timer);
        // получаем токен и user после подтверждения
        api.authTgConfirm(JSON.stringify({ login_token: loginToken })).then(function(r){
          if(r && r.status === 200 && r.body && r.body.user){
            authState.user = r.body.user;
            state.nick = r.body.user.username;
            state.icon = r.body.user.icon && ['⛏️','🧱','⚔️','💎','🌲'].indexOf(r.body.user.icon)!==-1 ? r.body.user.icon : '⛏️';
            saveState(); renderProfile(); authRender();
            toast('Подтверждено, вход выполнен: ' + r.body.user.username);
          } else {
            authError(err, (r && r.body && r.body.message) ? r.body.message : 'Не удалось завершить вход.');
          }
        });
      } else if(status === 'denied'){
        clearInterval(timer);
        authError(err, 'Вход отклонён в Telegram');
      } else if(status === 'consumed'){
        clearInterval(timer);
        authError(err, 'Подтверждение уже использовано. Войдите заново.');
      }
    });
  }, 1500);
}

function doAuthRegister(){
  var u = $('regUser'), p = $('regPass'), p2 = $('regPass2'), err = $('authErr');
  var api = authApi();
  if(!api){ authError(err, 'Приложение не запущено как настольное.'); return; }
  var username = u ? u.value.trim() : '';
  var password = p ? p.value : '';
  var icon = '👑';
  if(!/^[A-Za-z0-9_]{3,16}$/.test(username)){ authError(err, 'Логин: 3–16 латинских букв, цифр или _.'); return; }
  if(password.length < 6){ authError(err, 'Пароль должен быть от 6 символов.'); return; }
  if(password !== (p2 ? p2.value : '')){ authError(err, 'Пароли не совпадают.'); return; }
  api.authRegister(JSON.stringify({ username: username, password: password, icon: icon })).then(function(res){
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      state.nick = res.body.user.username;
      saveState(); renderProfile(); authRender();
      toast('Аккаунт создан: ' + res.body.user.username);
    } else {
      authError(err, (res && res.body && res.body.message) ? res.body.message : 'Не удалось зарегистрироваться.');
    }
  });
}

function doAuthLogout(){
  var api = authApi();
  if(api && typeof api.authLogout === 'function') api.authLogout();
  authState.user = null;
  authRender();
  toast('Вы вышли из аккаунта');
}

// Вход по коду из Telegram (/code_cab в боте)
function doTgLogin(){
  var code = ($('tgLoginCode') ? $('tgLoginCode').value : '').trim();
  var err = $('tgLoginErr');
  var api = authApi();
  if(!api){ authError(err, 'Приложение не запущено как настольное.'); return; }
  if(!/^\d{6}$/.test(code)){ authError(err, 'Код из Telegram — 6 цифр.'); return; }
  api.authTgLogin(JSON.stringify({ code: code })).then(function(res){
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      state.nick = res.body.user.username;
      state.icon = res.body.user.icon && ['⛏️','🧱','⚔️','💎','🌲'].indexOf(res.body.user.icon)!==-1 ? res.body.user.icon : '⛏️';
      saveState(); renderProfile(); authRender();
      toast('Вход через Telegram: ' + res.body.user.username);
    } else {
      authError(err, (res && res.body && res.body.message) ? res.body.message : 'Не удалось войти.');
    }
  });
}

// Смена пароля (кабинета и Minecraft) из раздела «Прочее»
function doAuthChangePassword(){
  var oldP = $('cpOld') ? $('cpOld').value : '';
  var newP = $('cpNew') ? $('cpNew').value : '';
  var newP2 = $('cpNew2') ? $('cpNew2').value : '';
  var err = $('cpErr');
  var api = authApi();
  if(!api || typeof api.authChangePassword !== 'function'){ if(err) err.textContent='Приложение не запущено как настольное.'; return; }
  if(!oldP || !newP){ if(err) err.textContent='Заполните все поля.'; return; }
  if(newP.length < 6){ if(err) err.textContent='Новый пароль — минимум 6 символов.'; return; }
  if(newP !== newP2){ if(err) err.textContent='Пароли не совпадают.'; return; }
  if(err) err.textContent = '';
  api.authChangePassword(JSON.stringify({ old_password: oldP, new_password: newP })).then(function(res){
    if(res && res.status === 200 && res.body && res.body.status === 'ok'){
      if(err){ err.textContent = 'Пароль изменён. Теперь он действует и в Minecraft.'; err.style.color = '#7df26d'; }
      if($('cpOld')) $('cpOld').value = '';
      if($('cpNew')) $('cpNew').value = '';
      if($('cpNew2')) $('cpNew2').value = '';
      toast('Пароль изменён');
    } else {
      if(err){ err.textContent = (res && res.body && res.body.message) ? res.body.message : 'Не удалось изменить пароль.'; err.style.color = 'var(--danger)'; }
    }
  });
}

function bindAuth(){
  var b = $('authLoginBtn'); if(b) b.onclick = doAuthLogin;
  var r = $('authRegisterBtn'); if(r) r.onclick = doAuthRegister;
  var tg = $('tgLoginBtn'); if(tg) tg.onclick = doAuthTgLogin;
  var lo = $('authLogoutBtn'); if(lo) lo.onclick = doAuthLogout;
  var t1 = $('tabAuthLogin'); if(t1) t1.onclick = function(){ if($('authPaneLogin')) $('authPaneLogin').style.display=''; if($('authPaneRegister')) $('authPaneRegister').style.display='none'; };
  var t2 = $('tabAuthRegister'); if(t2) t2.onclick = function(){ if($('authPaneLogin')) $('authPaneLogin').style.display='none'; if($('authPaneRegister')) $('authPaneRegister').style.display=''; };
  var up = $('avatarUploadBtn'); if(up) up.onclick = uploadAvatar;
  var pf = $('avatarFile'); if(pf) pf.onchange = function(){ var upb = $('avatarUploadBtn'); if(upb) upb.disabled = !pf.files.length; };
  var skb = $('skinUploadBtn'); if(skb) skb.onclick = uploadSkin;
  var skf = $('skinFile'); if(skf) skf.onchange = function(){ var s = $('skinUploadBtn'); if(s) s.disabled = !skf.files.length; };
}

function uploadAvatar(){
  var api = authApi();
  var file = $('avatarFile'), msg = $('avatarMsg');
  if(!api || typeof api.authUploadAvatar !== 'function'){ if(msg) msg.textContent='Доступно в настольном приложении.'; return; }
  if(!file || !file.files || !file.files[0]){ if(msg) msg.textContent='Выберите файл.'; return; }
  if(!authState.user){ if(msg) msg.textContent='Сначала войдите в кабинет.'; return; }
  var fd = new FormData();
  fd.append('avatar', file.files[0]);
  if(msg) msg.textContent = 'Загружаю…';
  api.authUploadAvatar(fd).then(function(res){
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      saveState();
      renderProfile();
      authRender();
      if(msg){ msg.textContent = 'Аватар обновлён.'; msg.style.color = '#7df26d'; }
      toast('Аватар обновлён');
    } else {
      if(msg){ msg.textContent = (res && res.body && res.body.message) ? res.body.message : 'Не удалось загрузить аватар.'; msg.style.color = 'var(--danger)'; }
    }
  }).catch(function(e){
    if(msg){ msg.textContent = 'Нет связи с сервером.'; msg.style.color = 'var(--danger)'; }
  });
}

function uploadSkin(){
  var api = authApi();
  var file = $('skinFile'), msg = $('skinMsg');
  if(!api || typeof api.authUploadSkin !== 'function'){ if(msg) msg.textContent='Доступно в настольном приложении.'; return; }
  if(!file || !file.files || !file.files[0]){ if(msg) msg.textContent='Выберите файл.'; return; }
  var f = file.files[0];
  if(f.type !== 'image/png'){ if(msg) msg.textContent='Скин должен быть в формате PNG.'; return; }
  if(!authState.user){ if(msg) msg.textContent='Сначала войдите в кабинет.'; return; }
  var fd = new FormData();
  fd.append('skin', f);
  if(msg) msg.textContent = 'Загружаю…';
  api.authUploadSkin(fd).then(function(res){
    if(res && res.status === 200 && res.body && res.body.user){
      authState.user = res.body.user;
      saveState();
      renderProfile();
      authRender();
      if(msg){ msg.textContent = 'Скин загружен. Применится на сервере (перезайдите в игру).'; msg.style.color = '#7df26d'; }
      toast('Скин загружен');
    } else {
      if(msg){ msg.textContent = (res && res.body && res.body.message) ? res.body.message : 'Не удалось загрузить скин.'; msg.style.color = 'var(--danger)'; }
    }
  }).catch(function(e){
    if(msg){ msg.textContent = 'Нет связи с сервером.'; msg.style.color = 'var(--danger)'; }
  });
}

/* ---------- local profile ---------- */
var STORE_KEY = 'lordgames-v1';
var state = { nick:'', icon:'⛏️', history:[] };

function loadState(){
  try {
    var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if(s && typeof s === 'object'){
      state.nick = typeof s.nick === 'string' ? s.nick : '';
      state.icon = ['⛏️','🧱','⚔️','💎','🌲'].indexOf(s.icon) !== -1 ? s.icon : '⛏️';
      state.history = Array.isArray(s.history) ? s.history.slice(0,30) : [];
    }
  } catch(e){}
}

function saveState(){
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch(e){
    return false;
  }
}

function recordHistory(name){
  state.history.unshift({ name:name, date:Date.now() });
  state.history = state.history.slice(0,30);
  saveState();
  renderProfile();
}

function renderProfile(){
  var nameEl = $('profileName');
  var iconEl = $('profileIcon');
  var nickEl = $('nick');
  var iconSel = $('icon');
  var hist = $('history');
  var playName = $('playName');
  var playIcon = $('playIcon');
  var nickFast = $('nickFast');

  // Ник лаунчера всегда из личного кабинета (authState), иначе — пусто/гость
  var accNick = (authState && authState.user) ? authState.user.username : '';

  if(nameEl) nameEl.textContent = accNick || 'Гость';
  if(iconEl) iconEl.textContent = state.icon || '⛏️';
  if(nickEl) nickEl.value = accNick || '';
  if(nickEl) nickEl.readOnly = !!authState.user;
  if(iconSel) iconSel.value = state.icon || '⛏️';
  if(playName) playName.textContent = accNick || 'Гость';
  if(playIcon) playIcon.textContent = state.icon || '⛏️';
  if(nickFast){ nickFast.value = accNick || ''; nickFast.readOnly = !!authState.user; }
  var saveNickBtn = $('saveNick');
  if(saveNickBtn) saveNickBtn.disabled = !!authState.user;

  if(hist){
    hist.replaceChildren();
    if(!state.history.length){
      var empty = document.createElement('div');
      empty.className = 'history-item muted';
      empty.textContent = 'История пока пуста.';
      hist.appendChild(empty);
    } else {
      state.history.forEach(function(item){
        var el = document.createElement('div');
        el.className = 'history-item';
        var b = document.createElement('b');
        b.textContent = item.name + ' — переход к оплате';
        var small = document.createElement('small');
        small.textContent = new Date(item.date).toLocaleString('ru-RU') + ' · статус не проверен';
        el.appendChild(b);
        el.appendChild(small);
        hist.appendChild(el);
      });
    }
  }
}

function bindProfile(){
  var form = $('form');
  var clearBtn = $('clearData');
  var error = $('error');

  if(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var nick = $('nick').value.trim();
      if(!/^[A-Za-z0-9_]{3,16}$/.test(nick)){
        if(error) error.textContent = 'Ник должен содержать 3–16 латинских букв, цифр или _.';
        return;
      }
      if(error) error.textContent = '';
      state.nick = nick;
      state.icon = $('icon').value;
      saveState();
      renderProfile();
      toast('Профиль сохранён на устройстве');
    });
  }

  if(clearBtn){
    clearBtn.addEventListener('click', function(){
      if(!confirm('Удалить локальный профиль и историю?')) return;
      state = { nick:'', icon:'⛏️', history:[] };
      saveState();
      renderProfile();
      toast('Локальные данные удалены');
    });
  }
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', function(){
  loadState();
  bindNav();
  bindCopy();
  bindOpenShop();
  bindStore();
  bindProfile();
  bindPlay();
  bindAuth();
  renderProfile();
  authCheck();
  updateVersionLabels();
  loadLaunchState();
});

window.LordOfTheGames = {
  goPage: goPage,
  openShop: openShop,
  copyText: copyText,
  recordHistory: recordHistory
};
})();