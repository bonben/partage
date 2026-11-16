import { highlightSearchTerm } from "./highlight-search-term.js";

document.addEventListener("DOMContentLoaded", function () {
  const allItems = document.querySelectorAll(".bibliography > li");
  const totalCount = allItems.length;
  const countTextEl = document.getElementById("pub-count-text");
  const resetBtnEl = document.getElementById("pub-reset-btn");
  const yearChartEl = document.getElementById("pub-year-chart");

  // Build interactive Year Spark-Chart from h2.bibliography headings
  const yearSections = [];
  document.querySelectorAll("h2.bibliography").forEach((heading) => {
    const yearText = heading.textContent.trim();
    const ol = heading.nextElementSibling;
    if (ol && ol.tagName === "OL") {
      const items = ol.querySelectorAll(":scope > li");
      yearSections.push({ year: yearText, heading, ol, items, total: items.length });
    }
  });

  // Accent- and case-insensitive text, so "Leonardon" matches "Léonardon".
  const normalize = (text) =>
    (text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  // Searchable text of each entry: visible text plus the full author list,
  // which the page collapses to "N more authors" after the first ones.
  const searchText = new Map();
  allItems.forEach((el) => {
    const hiddenAuthors = el.querySelector(".bib-search-authors");
    searchText.set(el, normalize(el.innerText + " " + (hiddenAuthors ? hiddenAuthors.textContent : "")));
  });

  const barHeight = (count, max) => (count > 0 ? Math.max(16, Math.round((count / max) * 100)) : 0);

  // The chart shows the last eight years plus the current one, oldest to newest.
  const firstChartYear = new Date().getFullYear() - 8;
  const chartSections = yearSections.filter((sec) => parseInt(sec.year, 10) >= firstChartYear);

  if (yearChartEl && chartSections.length > 0) {
    const maxYearTotal = Math.max(...chartSections.map((y) => y.total), 1);
    [...chartSections]
      .reverse()
      .forEach((sec) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "year-bar-btn";
        btn.dataset.year = sec.year;
        btn.title = `${sec.year}: ${sec.total} publications (click to filter)`;
        const heightPct = barHeight(sec.total, maxYearTotal);
        btn.innerHTML = `
          <span class="year-bar-count">${sec.total}</span>
          <span class="year-bar-track"><span class="year-bar-fill" style="height:${heightPct}%"></span></span>
          <span class="year-bar-label">${sec.year.slice(-2)}'</span>
        `;
        btn.addEventListener("click", () => {
          const input = document.getElementById("bibsearch");
          const current = (input ? input.value : "").trim();
          const nextTerm = current === sec.year ? "" : sec.year;
          if (input) input.value = nextTerm;
          if (history.replaceState) {
            history.replaceState(null, "", nextTerm ? "#" + encodeURIComponent(nextTerm) : window.location.pathname);
          }
          filterItems(nextTerm);
        });
        yearChartEl.appendChild(btn);
      });
  }

  const updateStatsBar = (rawTerm) => {
    const visibleCount = document.querySelectorAll(".bibliography > li:not(.unloaded)").length;
    if (countTextEl) {
      if (!rawTerm) {
        countTextEl.innerHTML = `Showing all <strong>${totalCount}</strong> publications`;
      } else {
        countTextEl.innerHTML = `Showing <strong>${visibleCount}</strong> of ${totalCount} publications matching <em>"${rawTerm}"</em>`;
      }
    }
    if (resetBtnEl) {
      resetBtnEl.classList.toggle("is-hidden", !rawTerm);
    }
    if (yearChartEl) {
      // Redraw the bars from the entries matching the current filter.
      const visibleByYear = new Map(
        chartSections.map((sec) => [sec.year, [...sec.items].filter((el) => !el.classList.contains("unloaded")).length])
      );
      const maxVisible = Math.max(...visibleByYear.values(), 1);
      yearChartEl.querySelectorAll(".year-bar-btn").forEach((btn) => {
        const count = visibleByYear.get(btn.dataset.year) || 0;
        const countEl = btn.querySelector(".year-bar-count");
        const fillEl = btn.querySelector(".year-bar-fill");
        if (countEl) countEl.textContent = count;
        if (fillEl) fillEl.style.height = barHeight(count, maxVisible) + "%";
        btn.title = `${btn.dataset.year}: ${count} publications (click to filter)`;
        btn.classList.toggle("is-active", rawTerm.toLowerCase() === (btn.dataset.year || "").toLowerCase());
      });
    }
  };

  const filterItems = (rawSearchTerm) => {
    const cleanRaw = (rawSearchTerm || "").trim();
    const searchTerm = cleanRaw.toLowerCase();

    // 1. Reset all unloaded elements
    document.querySelectorAll(".unloaded").forEach((el) => el.classList.remove("unloaded"));

    // 2. Sync filter pills immediately so active state is always 100% accurate
    document.querySelectorAll(".filter-pill").forEach(function (pill) {
      const pTerm = (pill.dataset.term || "").trim().toLowerCase();
      if (!searchTerm && !pTerm) {
        pill.classList.add("is-active");
      } else if (pTerm && searchTerm === pTerm) {
        pill.classList.add("is-active");
      } else {
        pill.classList.remove("is-active");
      }
    });

    // Keep the author menu in step with the search box.
    const authorSelect = document.getElementById("author-filter");
    if (authorSelect) {
      const option = [...authorSelect.options].find((o) => o.value && o.value.toLowerCase() === searchTerm);
      authorSelect.value = option ? option.value : "";
    }

    // 3. If searchTerm is empty, reset highlights and restore all
    if (!searchTerm) {
      if (CSS.highlights) {
        CSS.highlights.delete("search");
      }
      updateStatsBar("");
      return;
    }

    // 4. Otherwise, filter items on the full searchable text (hidden authors
    //    included, accents ignored), then highlight the visible matches.
    const needle = normalize(searchTerm);
    allItems.forEach((el) => {
      if ((searchText.get(el) || "").indexOf(needle) === -1) {
        el.classList.add("unloaded");
      }
    });
    if (CSS.highlights) {
      highlightSearchTerm({ search: searchTerm, selector: ".bibliography > li" });
    }

    // 5. Hide empty year/group headings
    document.querySelectorAll("h2.bibliography").forEach(function (element) {
      let iterator = element.nextElementSibling;
      let hideHeading = true;
      while (iterator && iterator.tagName !== "H2") {
        if ("OL" === iterator.tagName) {
          const unloaded = iterator.querySelectorAll(":scope > li.unloaded");
          const total = iterator.querySelectorAll(":scope > li");
          if (unloaded.length === total.length) {
            if (iterator.previousElementSibling) {
              iterator.previousElementSibling.classList.add("unloaded");
            }
            iterator.classList.add("unloaded");
          } else {
            hideHeading = false;
          }
        }
        iterator = iterator.nextElementSibling;
      }
      if (hideHeading) {
        element.classList.add("unloaded");
      }
    });

    updateStatsBar(cleanRaw);
  };

  const updateInputField = () => {
    const hashValue = decodeURIComponent(window.location.hash.substring(1)).trim();
    const input = document.getElementById("bibsearch");
    if (input) {
      input.value = hashValue;
    }
    filterItems(hashValue);
  };

  // Hook input search
  const inputEl = document.getElementById("bibsearch");
  let timeoutId;
  if (inputEl) {
    inputEl.addEventListener("input", function () {
      clearTimeout(timeoutId);
      const val = this.value;
      timeoutId = setTimeout(() => filterItems(val), 120);
    });
  }

  // Hook reset button
  if (resetBtnEl) {
    resetBtnEl.addEventListener("click", function () {
      const input = document.getElementById("bibsearch");
      if (input) input.value = "";
      if (history.replaceState) {
        history.replaceState(null, "", window.location.pathname);
      } else {
        window.location.hash = "";
      }
      filterItems("");
    });
  }

  // Hook pill clicks
  document.querySelectorAll(".filter-pill").forEach(function (pill) {
    pill.addEventListener("click", function (e) {
      e.preventDefault();
      const term = (this.dataset.term || "").trim();
      const input = document.getElementById("bibsearch");

      if (this.classList.contains("is-active") && term) {
        if (input) input.value = "";
        if (history.replaceState) {
          history.replaceState(null, "", window.location.pathname);
        } else {
          window.location.hash = "";
        }
        filterItems("");
      } else {
        if (input) input.value = term;
        if (history.replaceState) {
          history.replaceState(null, "", term ? "#" + encodeURIComponent(term) : window.location.pathname);
        } else {
          window.location.hash = term ? encodeURIComponent(term) : "";
        }
        filterItems(term);
      }
    });
  });

  // Author menu: filters on the member's full name.
  const authorSelectEl = document.getElementById("author-filter");
  if (authorSelectEl) {
    authorSelectEl.addEventListener("change", function () {
      const term = this.value;
      const input = document.getElementById("bibsearch");
      if (input) input.value = term;
      if (history.replaceState) {
        history.replaceState(null, "", term ? "#" + encodeURIComponent(term) : window.location.pathname);
      }
      filterItems(term);
    });
  }

  window.addEventListener("hashchange", updateInputField);

  updateInputField();
});
