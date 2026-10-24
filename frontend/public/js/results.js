(function () {
  'use strict';

  var UI = window.UI;

  var els = {
    topNewBtn: document.getElementById('top-new-btn'),
    returnSetupBtn: document.getElementById('return-setup-btn'),
    newInterviewBtn: document.getElementById('new-interview-btn'),
    resultsError: document.getElementById('results-error'),
    resultsErrorText: document.getElementById('results-error-text'),
    resultsErrorBack: document.getElementById('results-error-back'),
    closingMessage: document.getElementById('closing-message'),
    summaryChips: document.getElementById('summary-chips'),
    ratingCard: document.getElementById('rating-card'),
    ratingOverall: document.getElementById('rating-overall'),
    ratingGrade: document.getElementById('rating-grade'),
    ratingDims: document.getElementById('rating-dims'),
    ratingNote: document.getElementById('rating-note'),
    suggestionsBox: document.getElementById('suggestions-box'),
    scoreRing: document.getElementById('score-ring-fg'),
    statsGrid: document.getElementById('stats-grid'),
    wordsChart: document.getElementById('words-chart'),
    difficultyTimeline: document.getElementById('difficulty-timeline'),
    copyBtn: document.getElementById('copy-btn'),
    exportTxtBtn: document.getElementById('export-txt-btn'),
    exportMdBtn: document.getElementById('export-md-btn'),
    shareBtn: document.getElementById('share-btn'),
    completeTranscript: document.getElementById('complete-transcript'),
  };

  var RATING_DIMS = [
    ['technical', 'Technical'],
    ['problemSolving', 'Problem Solving'],
    ['communication', 'Communication'],
    ['clarity', 'Clarity'],
    ['confidence', 'Confidence'],
    ['adaptability', 'Adaptability'],
  ];

  var DIFFICULTY_LABELS = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
  };

  var DIM_COLORS = ['#2dd4a7', '#34d399', '#10b981', '#14b8a6', '#0ea5e9', '#6366f1'];

  var lastSummary = null;

  // --------------------------------------------------------- helpers

  function displayPosition(summary) {
    return summary && summary.customPosition && summary.position === 'Custom Position'
      ? summary.customPosition
      : (summary ? summary.position : '');
  }

  function latestAiMessage(summary) {
    var entries = summary.transcript || [];
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role !== 'candidate') return entries[i].text;
    }
    return '';
  }

  function addBubble(container, role, text) {
    var div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    container.appendChild(div);
    return div;
  }

  function renderTranscript(container, transcript, timing) {
    container.innerHTML = '';
    var candIndex = 0;
    (transcript || []).forEach(function (entry) {
      var isCandidate = entry.role === 'candidate';
      var bubble = addBubble(container, isCandidate ? 'candidate' : 'interviewer', entry.text || '');
      if (isCandidate) {
        var info = timing && timing[candIndex];
        candIndex += 1;
        if (info) {
          var parts = [];
          if (info.number != null) parts.push('Q' + info.number);
          if (info.wordCount) parts.push(info.wordCount + ' words');
          if (info.elapsedMs) parts.push(UI.formatDuration(info.elapsedMs));
          if (parts.length) {
            var tag = document.createElement('span');
            tag.className = 'bubble-tag';
            tag.textContent = parts.join('  \u00b7  ');
            bubble.insertBefore(tag, bubble.firstChild);
          }
        }
      }
    });
  }

  // --------------------------------------------------------- rating / charts

  function ringLength() {
    return window.Charts && window.Charts.circleLength
      ? window.Charts.circleLength(52)
      : 2 * Math.PI * 52;
  }

  function resetScoreRing() {
    if (!els.scoreRing) return;
    var L = ringLength();
    els.scoreRing.setAttribute('stroke-dasharray', String(L));
    els.scoreRing.setAttribute('stroke-dashoffset', String(L));
  }

  function animateScoreRing(overall) {
    if (!els.scoreRing) return;
    var L = ringLength();
    var pct = Math.max(0, Math.min(10, overall));
    els.scoreRing.setAttribute('stroke-dasharray', String(L));
    els.scoreRing.setAttribute('stroke-dashoffset', String(L * (1 - pct / 10)));
  }

  function renderRating(evaluation) {
    if (!evaluation) {
      els.ratingOverall.textContent = '\u2014';
      if (els.ratingGrade) els.ratingGrade.textContent = '';
      els.ratingNote.textContent = '';
      els.ratingDims.innerHTML = '';
      els.suggestionsBox.classList.add('hidden');
      if (els.ratingCard) els.ratingCard.classList.remove('tone-good', 'tone-mid', 'tone-low');
      resetScoreRing();
      return;
    }
    var overall = Number(evaluation.overall);
    els.ratingOverall.textContent = Number.isFinite(overall) ? overall.toFixed(1) : '\u2014';
    els.ratingNote.textContent = evaluation.note || '';

    var tone = 'tone-low';
    var grade = 'Needs work';
    if (overall >= 8) { tone = 'tone-good'; grade = 'Excellent'; }
    else if (overall >= 6) { tone = 'tone-mid'; grade = 'Good'; }
    if (els.ratingCard) {
      els.ratingCard.classList.remove('tone-good', 'tone-mid', 'tone-low');
      els.ratingCard.classList.add(tone);
    }
    if (els.ratingGrade) els.ratingGrade.textContent = grade;
    animateScoreRing(Number.isFinite(overall) ? overall : 0);

    var rows = RATING_DIMS.map(function (d, i) {
      var val = Number(evaluation[d[0]]);
      if (!Number.isFinite(val)) val = 0;
      var pct = Math.max(0, Math.min(100, val * 10));
      var color = DIM_COLORS[i % DIM_COLORS.length];
      return (
        '<div class="rating-row">' +
        '<span class="rating-label">' + d[1] + '</span>' +
        '<div class="rating-bar"><div class="rating-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<span class="rating-val">' + val + '</span>' +
        '</div>'
      );
    }).join('');
    els.ratingDims.innerHTML = rows;

    var suggestions = (evaluation.suggestions || []).filter(function (s) {
      return s && s.trim();
    });
    els.suggestionsBox.classList.toggle('hidden', !suggestions.length);
    els.suggestionsBox.innerHTML = '';
    if (suggestions.length) {
      var title = document.createElement('h3');
      title.className = 'suggestions-title';
      title.textContent = 'How to improve';
      els.suggestionsBox.appendChild(title);
      var ul = document.createElement('ul');
      suggestions.forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      });
      els.suggestionsBox.appendChild(ul);
    }
  }

  function renderStats(stats) {
    els.statsGrid.innerHTML = '';
    if (!stats) {
      var empty = document.createElement('p');
      empty.className = 'panel-note';
      empty.textContent = 'No answer insights available for this session.';
      els.statsGrid.appendChild(empty);
      return;
    }
    var cells = [
      ['Total words', stats.totalWords],
      ['Avg words / answer', stats.avgWordsPerAnswer],
      ['Longest answer', stats.longestAnswerWords + ' words'],
      ['Shortest answer', stats.shortestAnswerWords + ' words'],
      ['Avg time / answer', stats.avgMsPerAnswer ? UI.formatDuration(stats.avgMsPerAnswer) : '\u2014'],
      ['Answers given', stats.answeredQuestions],
    ];
    cells.forEach(function (c) {
      var cell = document.createElement('div');
      cell.className = 'stat-cell';
      var v = document.createElement('span');
      v.className = 'stat-val';
      v.textContent = String(c[1]);
      var l = document.createElement('span');
      l.className = 'stat-label';
      l.textContent = c[0];
      cell.appendChild(v);
      cell.appendChild(l);
      els.statsGrid.appendChild(cell);
    });
  }

  function renderDifficultyTimeline(summary) {
    els.difficultyTimeline.innerHTML = '';
    var questions = summary.questions || summary.questionTiming || [];
    if (!questions.length) {
      var empty = document.createElement('p');
      empty.className = 'panel-note';
      empty.textContent = 'No per-question difficulty recorded.';
      els.difficultyTimeline.appendChild(empty);
      return;
    }

    if (window.Charts && window.Charts.line) {
      var points = questions.map(function (q, i) {
        var diff = q.difficulty || summary.difficulty || 'intermediate';
        return {
          k: q.number || i + 1,
          ks: diff,
          value: diff === 'beginner' ? 1 : diff === 'advanced' ? 3 : 2,
        };
      });
      els.difficultyTimeline.innerHTML = window.Charts.line(points);
      var legend = document.createElement('div');
      legend.className = 'diff-legend';
      legend.innerHTML =
        '<span class="diff-chip beginner">Beginner</span>' +
        '<span class="diff-chip intermediate">Intermediate</span>' +
        '<span class="diff-chip advanced">Advanced</span>';
      els.difficultyTimeline.appendChild(legend);
      return;
    }

    questions.forEach(function (q, i) {
      var diff = q.difficulty || summary.difficulty || 'intermediate';
      var el = document.createElement('span');
      el.className = 'diff-chip ' + diff;
      var num = document.createElement('span');
      num.className = 'diff-num';
      num.textContent = 'Q' + (q.number || i + 1);
      el.appendChild(num);
      el.appendChild(document.createTextNode(DIFFICULTY_LABELS[diff] || UI.titleCase(diff)));
      els.difficultyTimeline.appendChild(el);
    });
  }

  function renderWordsChart(summary) {
    if (!els.wordsChart) return;
    els.wordsChart.innerHTML = '';
    var timing = (summary && summary.questionTiming) || [];
    var items = timing.filter(function (t) { return t.wordCount != null; })
      .map(function (t) { return { k: 'Q' + (t.number != null ? t.number : ''), value: t.wordCount }; });
    if (!items.length) {
      var note = document.createElement('p');
      note.className = 'panel-note';
      note.textContent = 'No per-question word counts recorded.';
      els.wordsChart.appendChild(note);
      return;
    }
    if (window.Charts && window.Charts.bars) {
      els.wordsChart.innerHTML = window.Charts.bars(items);
    }
  }

  // --------------------------------------------------------- summary render

  function renderSummaryChips(summary) {
    els.summaryChips.innerHTML = '';
    var chips = [];
    if (summary.evaluation) {
      chips.push({ val: String(Number(summary.evaluation.overall) || 0), label: 'Score' });
    }
    chips.push({ val: String(summary.questionCount || 0), label: 'Questions' });
    if (summary.startedAt && summary.completedAt) {
      chips.push({ val: UI.formatDuration(summary.completedAt - summary.startedAt) || '0s', label: 'Duration' });
    }
    if (summary.stats && summary.stats.totalWords != null) {
      chips.push({ val: String(summary.stats.totalWords), label: 'Words' });
    }
    chips.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'summary-chip';
      var v = document.createElement('span');
      v.className = 'sc-val';
      v.textContent = c.val;
      var l = document.createElement('span');
      l.className = 'sc-label';
      l.textContent = c.label;
      el.appendChild(v);
      el.appendChild(l);
      els.summaryChips.appendChild(el);
    });
  }

  function renderResults(summary) {
    lastSummary = summary;

    var evalAvailable = !!summary.evaluation;
    els.ratingCard.classList.toggle('hidden', !evalAvailable);

    renderRating(summary.evaluation);
    renderPracticePlan(summary);
    renderSummaryChips(summary);
    renderStats(summary.stats);
    renderWordsChart(summary);
    renderDifficultyTimeline(summary);
    renderTranscript(els.completeTranscript, summary.transcript, summary.questionTiming);

    var close = latestAiMessage(summary) || '';
    els.closingMessage.textContent = close || 'Thank you for your time.';
    document.title = 'AI Interviewer Hotsilog \u2014 Results';

    UI.upsertHistory({
      interviewId: summary.interviewId,
      position: displayPosition(summary),
      date: summary.completedAt || Date.now(),
      status: 'completed',
      score: evalAvailable ? Number(summary.evaluation.overall) : null,
    });
  }

  function renderPracticePlan(summary) {
    var panel = document.getElementById('next-practice');
    var evaluation = summary.evaluation;
    var dimensions = RATING_DIMS.filter(function (dim) {
      return evaluation && evaluation[dim[0]] != null && Number.isFinite(Number(evaluation[dim[0]]));
    }).sort(function (a, b) { return Number(evaluation[a[0]]) - Number(evaluation[b[0]]); });
    panel.classList.toggle('hidden', !dimensions.length);
    if (!dimensions.length) return;
    var focus = dimensions[0];
    var technical = focus[0] === 'technical' || focus[0] === 'problemSolving';
    document.getElementById('practice-focus').textContent = 'Focus on ' + focus[1].toLowerCase() + ' (' + Number(evaluation[focus[0]]) + '/10). This was your lowest scored area in this session; tied areas are shown in rubric order.';
    var tasks = technical ? [
      'Pick one technical answer from the transcript and identify a missing detail or unclear assumption.',
      'Explain your approach again, including an alternative and why you chose your solution.',
      'Try a five-question technical session for the same role.'
    ] : [
      'Pick one answer from your transcript and identify where your message became unclear.',
      'Rewrite it using a real situation, your task, the actions you took, and the result.',
      'Try a five-question behavioral session, keeping your own contribution clear.'
    ];
    var list = document.getElementById('practice-tasks');
    list.replaceChildren();
    tasks.forEach(function (task) {
      var item = document.createElement('li');
      item.textContent = task;
      list.appendChild(item);
    });
    document.getElementById('practice-focus-btn').onclick = function () {
      var draft = {};
      try { draft = JSON.parse(localStorage.getItem('ai-interviewer:setup')) || {}; } catch (e) { /* use session settings */ }
      draft.position = summary.position;
      draft.customPosition = summary.customPosition || '';
      draft.difficulty = summary.difficulty || 'intermediate';
      draft.interviewType = technical ? 'technical' : 'behavioral';
      draft.questionCount = '5';
      draft.mode = 'text';
      try { localStorage.setItem('ai-interviewer:setup', JSON.stringify(draft)); } catch (e) {
        UI.toast('Your browser could not save the practice plan. Return to setup and choose five questions.');
        return;
      }
      UI.clearSession();
      UI.flash('Five-question ' + draft.interviewType + ' practice is ready to review.');
      location.href = 'index.html#setup-form';
    };
  }

  // --------------------------------------------------------- export

  function buildTranscriptText(summary, format) {
    var L = [];
    L.push('AI Interviewer \u2014 Interview Results');
    L.push('Position: ' + displayPosition(summary));
    L.push('Type: ' + UI.titleCase(summary.interviewType || ''));
    L.push('Difficulty: ' + UI.titleCase(summary.difficulty || ''));
    L.push('Questions: ' + (summary.questionCount || 0));
    if (summary.evaluation) {
      L.push('Overall: ' + Number(summary.evaluation.overall).toFixed(1) + '/10');
      var dims = [
        ['technical', 'Technical'],
        ['problemSolving', 'Problem Solving'],
        ['communication', 'Communication'],
        ['clarity', 'Clarity'],
        ['confidence', 'Confidence'],
        ['adaptability', 'Adaptability']
      ];
      dims.forEach(function (d) {
        var val = Number(summary.evaluation[d[0]]);
        if (Number.isFinite(val)) {
          L.push(d[1] + ': ' + val + '/10');
        }
      });
    }
    if (summary.stats && summary.stats.totalWords != null) {
      L.push('Words: ' + summary.stats.totalWords + ' (avg ' + summary.stats.avgWordsPerAnswer + '/answer)');
    }
    L.push('');
    if (summary.evaluation && summary.evaluation.note) {
      L.push('Note: ' + summary.evaluation.note);
      L.push('');
    }
    if (summary.evaluation && summary.evaluation.suggestions && summary.evaluation.suggestions.length) {
      L.push('Suggestions:');
      summary.evaluation.suggestions.forEach(function (s) { L.push(format === 'md' ? '- ' + s : ' - ' + s); });
      L.push('');
    }
    L.push(format === 'md' ? '## Transcript' : '=== Transcript ===');
    (summary.transcript || []).forEach(function (t) {
      var who = t.role === 'candidate' ? (format === 'md' ? '**You**' : 'YOU') : (format === 'md' ? '**Interviewer**' : 'INTERVIEWER');
      L.push(who + ': ' + t.text);
    });
    return L.join('\n');
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // --------------------------------------------------------- init

  function showError(message) {
    console.error('Results load failed:', message);
    var completeScreen = document.getElementById('complete-screen');
    if (completeScreen) completeScreen.classList.add('hidden');
    if (els.resultsError) {
      els.resultsError.classList.remove('hidden');
      if (els.resultsErrorText) els.resultsErrorText.textContent = message || 'We couldn\'t load this interview.';
    }
  }

  function initPage() {
    if (!(window.Auth && window.Auth.isLoggedIn())) {
      UI.clearSession();
      UI.flash('Sign in to view interview results.');
      location.href = 'login.html';
      return;
    }

    var params = new URLSearchParams(location.search);
    var id = params.get('id');
    var session = UI.loadSession();
    if (!id && session) id = session.interviewId;
    if (!id) {
      location.href = 'index.html';
      return;
    }

    UI.api('/api/interview/' + id)
      .then(function (summary) {
        UI.saveSession({ interviewId: id, startedAt: summary.startedAt || null, mode: 'text' });
        if (summary.status !== 'completed') {
          if (summary.transcript && summary.transcript.length) {
            location.href = 'interview.html?id=' + summary.interviewId;
          } else {
            location.href = 'index.html';
          }
          return;
        }
        renderResults(summary);
      })
      .catch(function (err) {
        showError((err && err.message) || 'We couldn\'t load this interview.');
      });
  }

  // --------------------------------------------------------- wiring

  els.copyBtn.addEventListener('click', function () {
    if (!lastSummary) return;
    var text = buildTranscriptText(lastSummary, 'txt');
    navigator.clipboard.writeText(text)
      .then(function () { UI.toast('Transcript copied to clipboard.'); })
      .catch(function () { UI.toast('Could not copy automatically.'); });
  });

  els.exportTxtBtn.addEventListener('click', function () {
    if (!lastSummary) return;
    downloadText('ai-interviewer-' + lastSummary.interviewId + '.txt', buildTranscriptText(lastSummary, 'txt'));
  });

  els.exportMdBtn.addEventListener('click', function () {
    if (!lastSummary) return;
    downloadText('ai-interviewer-' + lastSummary.interviewId + '.md', buildTranscriptText(lastSummary, 'md'));
  });

  els.shareBtn.addEventListener('click', function () {
    if (!lastSummary) return;
    var text = buildTranscriptText(lastSummary, 'txt');
    if (navigator.share) {
      navigator.share({ title: 'My AI interview results', text: text })
        .catch(function () { /* user cancelled */ });
    } else {
      navigator.clipboard.writeText(text)
        .then(function () { UI.toast('Shared as text \u2014 copied to clipboard.'); })
        .catch(function () { UI.toast('Clipboard unavailable.'); });
    }
  });

  els.returnSetupBtn.addEventListener('click', function () {
    UI.clearSession();
    location.href = 'index.html';
  });
  els.newInterviewBtn.addEventListener('click', function () {
    UI.clearSession();
    location.href = 'index.html';
  });
  if (els.topNewBtn) {
    els.topNewBtn.addEventListener('click', function () {
      UI.clearSession();
      location.href = 'index.html';
    });
  }

  if (els.resultsErrorBack) {
    els.resultsErrorBack.addEventListener('click', function () {
      UI.clearSession();
      location.href = 'index.html';
    });
  }

  initPage();
})();
