import { MAPS, mapById, type MapDef } from './config';

/**
 * 인트로: 배경 위에 맵 카드를 보여 주고 고른 맵을 돌려준다.
 * URL에 ?map=이 있으면 인트로를 건너뛴다(새로고침, 테스트). 고른 맵은 URL에 남긴다.
 */
export function chooseMap(): Promise<MapDef> {
  const params = new URLSearchParams(location.search);
  const preset = mapById(params.get('map'));
  const intro = document.getElementById('intro')!;
  if (preset) {
    intro.remove();
    return Promise.resolve(preset);
  }
  const base = import.meta.env.BASE_URL;
  intro.style.setProperty('--bg', `url(${base}images/intro_bg.webp)`);
  const list = intro.querySelector('.maps')!;
  for (const m of MAPS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'map-card' + (m.glb ? '' : ' small');
    card.innerHTML =
      (m.thumb ? `<img src="${base}${m.thumb}" alt="" loading="eager">` : '') +
      `<span class="name">${m.name}</span>` +
      `<span class="desc">${m.desc}</span>` +
      `<span class="meta">${m.size} · 적 ${m.enemies[0] + m.enemies[1]}기</span>`;
    card.dataset.id = m.id;
    list.appendChild(card);
  }
  intro.classList.remove('hidden');
  return new Promise((resolve) => {
    list.addEventListener('click', (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>('.map-card');
      const m = card && mapById(card.dataset.id ?? null);
      if (!m) return;
      params.set('map', m.id);
      history.replaceState(null, '', `${location.pathname}?${params}`);
      intro.remove();
      resolve(m);
    });
  });
}

/** 인트로로 돌아간다(?map 없이 다시 로드) */
export function backToIntro() {
  const params = new URLSearchParams(location.search);
  params.delete('map');
  const q = params.toString();
  location.href = location.pathname + (q ? `?${q}` : '');
}
