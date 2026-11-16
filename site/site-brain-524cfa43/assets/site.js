// Interactive behaviors for the BRAIN homepage:
// 1. Living network graph with ambient harmonic motion, pointer physics,
//    traveling signal pulses, live status readout, and click-to-explore.
// 2. Scroll progress indicator & sticky header state.
// 3. Scroll-triggered section reveals & animated stat counters.
// 4. Interactive tabs for Modalities, Selected Work, and People.

(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------------------
  // 0. Theme Mode (System Default + Discreet Switch)
  // ---------------------------------------------------------------------------
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const themeToggle = document.getElementById('theme-toggle');

  function applyHomepageTheme(setting) {
    const isDark = setting === 'dark' || (setting === 'system' && darkQuery && darkQuery.matches);
    document.documentElement.setAttribute('data-theme-setting', setting);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0b161e' : '#fcfcfc');
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', nextTheme);
      applyHomepageTheme(nextTheme);
    });
  }

  if (darkQuery) {
    darkQuery.addEventListener('change', () => {
      const stored = localStorage.getItem('theme');
      const setting = stored === 'dark' || stored === 'light' ? stored : 'system';
      applyHomepageTheme(setting);
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Interactive Network Illustration
  // ---------------------------------------------------------------------------
  const svg = document.querySelector('.network-art');
  if (svg) {
    const pulseGroup = svg.querySelector('.network-pulses');

    const nodes = [...svg.querySelectorAll('.network-node')].map((element, i) => {
      const x = Number(element.dataset.x);
      const y = Number(element.dataset.y);
      return {
        element,
        x,
        y,
        px: x,
        py: y,
        phaseX: i * 1.37 + 0.4,
        phaseY: i * 2.11 + 1.1,
        speedX: 0.00048 + (i % 3) * 0.00011,
        speedY: 0.00042 + (i % 4) * 0.00009,
        amp: i === 2 ? 1.1 : 2.0,
        name: element.dataset.name || '',
        role: element.dataset.role || '',
        href: element.dataset.href || '',
      };
    });

    const edges = [...svg.querySelectorAll('.network-edges line')].map((element) => ({
      element,
      from: Number(element.dataset.from),
      to: Number(element.dataset.to),
    }));

    // Create traveling signal pulses on a subset of edges
    const pulses = [];
    if (pulseGroup) {
      edges.forEach((edge, idx) => {
        if (idx % 2 === 0 || edge.from === 2 || edge.to === 2) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'signal-pulse');
          circle.setAttribute('r', '2.5');
          pulseGroup.appendChild(circle);
          pulses.push({
            element: circle,
            edgeIndex: idx,
            t: (idx * 0.19) % 1,
            speed: 0.0022 + (idx % 4) * 0.0006,
            dir: idx % 2 === 0 ? 1 : -1,
          });
        }
      });
    }

    let pointer = null;
    let active = -1;
    let focused = false;
    let frame = 0;
    let isVisible = true;

    function setActive(index) {
      if (active === index) return;
      active = index;
      nodes.forEach((node, i) => node.element.classList.toggle('is-active', i === index));
      edges.forEach((edge) =>
        edge.element.classList.toggle('is-active', index >= 0 && (edge.from === index || edge.to === index))
      );
      svg.classList.toggle('has-active-node', index >= 0);
    }

    function draw(now) {
      frame = 0;
      const t = now || performance.now();
      let keepRunning = !reducedMotion.matches && isVisible;

      nodes.forEach((node, i) => {
        let tx = node.x;
        let ty = node.y;

        if (!reducedMotion.matches) {
          // Gentle continuous ambient float
          tx += Math.sin(t * node.speedX + node.phaseX) * node.amp;
          ty += Math.cos(t * node.speedY + node.phaseY) * node.amp;

          if (pointer) {
            const dx = tx - pointer.x;
            const dy = ty - pointer.y;
            const distance = Math.hypot(dx, dy);
            if (i === active && distance < 42) {
              // Subtle magnetic pull toward pointer when directly hovered
              tx += (pointer.x - tx) * 0.1;
              ty += (pointer.y - ty) * 0.1;
            } else if (distance > 0 && distance < 115) {
              const influence = Math.max(0, 1 - distance / 115);
              tx += (dx / distance) * influence * 7;
              ty += (dy / distance) * influence * 7;
            }
          }
        }

        if (reducedMotion.matches) {
          node.px = tx;
          node.py = ty;
        } else {
          node.px += (tx - node.px) * 0.14;
          node.py += (ty - node.py) * 0.14;
        }

        node.element.setAttribute('transform', `translate(${node.px.toFixed(2)} ${node.py.toFixed(2)})`);
      });

      edges.forEach(({ element, from, to }) => {
        element.setAttribute('x1', nodes[from].px.toFixed(2));
        element.setAttribute('y1', nodes[from].py.toFixed(2));
        element.setAttribute('x2', nodes[to].px.toFixed(2));
        element.setAttribute('y2', nodes[to].py.toFixed(2));
      });

      // Animate signal pulses along edges
      pulses.forEach((pulse) => {
        const edge = edges[pulse.edgeIndex];
        const isEdgeActive = active >= 0 && (edge.from === active || edge.to === active);
        const speedMultiplier = isEdgeActive ? 2.1 : 1;

        if (!reducedMotion.matches) {
          if (isEdgeActive) {
            // Radiate outward from the active node
            const dir = edge.from === active ? 1 : -1;
            pulse.t = (pulse.t + pulse.speed * speedMultiplier * dir + 1) % 1;
          } else {
            pulse.t = (pulse.t + pulse.speed * pulse.dir + 1) % 1;
          }
        }

        const n1 = nodes[edge.from];
        const n2 = nodes[edge.to];
        const cx = n1.px + (n2.px - n1.px) * pulse.t;
        const cy = n1.py + (n2.py - n1.py) * pulse.t;
        pulse.element.setAttribute('cx', cx.toFixed(2));
        pulse.element.setAttribute('cy', cy.toFixed(2));
        pulse.element.classList.toggle('is-active', isEdgeActive);
      });

      if (keepRunning) {
        frame = requestAnimationFrame(draw);
      }
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    function pointFor(event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    }

    function updatePointer(event) {
      const point = pointFor(event);
      if (!point) return;
      pointer = point;
      let nearest = -1;
      let best = 85;
      nodes.forEach((node, i) => {
        const distance = Math.hypot(node.px - point.x, node.py - point.y);
        if (distance < best) {
          nearest = i;
          best = distance;
        }
      });
      setActive(nearest);
      schedule();
    }

    svg.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch') updatePointer(event);
    });
    svg.addEventListener('pointerleave', () => {
      pointer = null;
      if (!focused) setActive(-1);
      schedule();
    });
    svg.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') updatePointer(event);
    });

    // Member nodes open a small menu of links; other nodes navigate directly.
    const art = svg.parentElement;
    const menu = document.createElement('div');
    menu.className = 'node-menu';
    menu.hidden = true;
    art.appendChild(menu);

    function memberLinks(node) {
      const d = node.element.dataset;
      return [
        ['Website', d.website, true],
        ['Google Scholar', d.scholar, true],
        ['Publications', d.pubs, false],
      ].filter(([, url]) => url);
    }

    function closeMenu() {
      menu.hidden = true;
    }

    function openMenu(node, focusFirst) {
      menu.replaceChildren();
      const name = document.createElement('p');
      name.className = 'node-menu-name';
      name.textContent = node.name;
      menu.appendChild(name);
      memberLinks(node).forEach(([label, url, external]) => {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = label;
        if (external) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        menu.appendChild(a);
      });
      const nodeBox = node.element.getBoundingClientRect();
      const artBox = art.getBoundingClientRect();
      menu.hidden = false;
      const left = Math.min(
        Math.max(nodeBox.left + nodeBox.width / 2 - artBox.left - menu.offsetWidth / 2, 8),
        artBox.width - menu.offsetWidth - 8
      );
      menu.style.left = `${left}px`;
      menu.style.top = `${nodeBox.bottom - artBox.top + 6}px`;
      if (focusFirst) {
        const first = menu.querySelector('a');
        if (first) first.focus();
      }
    }

    function activate(node, index, fromKeyboard) {
      if (memberLinks(node).length) {
        setActive(index);
        openMenu(node, fromKeyboard);
      } else if (node.href) {
        window.location.href = node.href;
      } else {
        setActive(index);
      }
    }

    nodes.forEach((node, index) => {
      node.element.addEventListener('click', (event) => {
        event.stopPropagation();
        activate(node, index, false);
      });
    });

    document.addEventListener('click', (event) => {
      if (!menu.hidden && !menu.contains(event.target)) closeMenu();
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        svg.focus();
      }
    });

    svg.addEventListener('focus', () => {
      focused = true;
    });
    svg.addEventListener('blur', () => {
      focused = false;
      pointer = null;
      setActive(-1);
      schedule();
    });
    svg.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        pointer = null;
        setActive(-1);
        schedule();
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && active >= 0) {
        event.preventDefault();
        activate(nodes[active], active, true);
        return;
      }
      const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      const index = active < 0 ? 0 : (active + delta + nodes.length) % nodes.length;
      pointer = null;
      setActive(index);
      schedule();
    });

    // Pause animation loop when hero is scrolled out of view to save battery
    if ('IntersectionObserver' in window) {
      const heroObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            isVisible = entry.isIntersecting;
            if (isVisible) schedule();
          });
        },
        { threshold: 0.05 }
      );
      heroObserver.observe(svg);
    }

    reducedMotion.addEventListener('change', schedule);
    schedule();
  }

  // ---------------------------------------------------------------------------
  // 2. Sticky Header Polish
  // ---------------------------------------------------------------------------
  const headerShell = document.querySelector('.header-shell');

  function onScroll() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (headerShell) {
      headerShell.classList.toggle('is-scrolled', scrollTop > 18);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------------------------------------------------------------------------
  // 3. Scroll-Triggered Reveal
  // ---------------------------------------------------------------------------
  const revealSections = document.querySelectorAll('.reveal-section');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    revealSections.forEach((sec) => sec.classList.add('will-reveal'));
    const revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealSections.forEach((sec) => revealObserver.observe(sec));
  }

})();
