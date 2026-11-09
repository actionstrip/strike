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
  // CSS 변수 안의 상대 url()은 그 변수를 쓰는 스타일시트(빌드 후 assets/) 기준으로 풀리므로,
  // 페이지 기준 절대 주소로 바꿔 넘긴다(base가 './'인 빌드에서도 images/를 찾게)
  const bg = new URL(`${base}images/intro_bg.webp`, document.baseURI).href;
  intro.style.setProperty('--bg', `url("${bg}")`);
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
