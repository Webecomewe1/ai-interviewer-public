// This warm-up is deliberately local and deterministic, without an AI service.
(function () {
  'use strict';
  var questions = [
    'Tell me about a time you solved a difficult problem with a team.',
    'Describe a time you had to learn something quickly to finish a project.',
    'Tell me about a mistake you made and how you handled it.',
    'Describe a time you explained a technical idea to someone new to it.',
    'Tell me about a time you had to choose between competing priorities.'
  ];
  var tips = {
    situation: 'Set the scene. What was happening, and why did it matter?',
    task: 'Explain your responsibility. What specifically were you trying to achieve?',
    action: 'Describe what YOU did. Explain your decisions, not just what the team did.',
    result: 'Share what changed and what you learned. Use a concrete outcome when possible.'
  };
  var answer = document.getElementById('warmup-answer');
  var feedback = document.getElementById('warmup-feedback');
  var questionIndex = 0;
  var drafts = [];
  document.querySelectorAll('[data-star]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('[data-star]').forEach(function (tab) { tab.setAttribute('aria-pressed', String(tab === button)); });
      document.getElementById('star-tip').textContent = tips[button.dataset.star];
    });
  });
  function updateCount() {
    var count = answer.value.trim() ? answer.value.trim().split(/\s+/).length : 0;
    document.getElementById('warmup-count').textContent = count + (count === 1 ? ' word' : ' words');
  }
  answer.addEventListener('input', function () {
    updateCount();
    feedback.textContent = 'Your warm-up stays on this page. This is guided self-practice, without AI scoring.';
  });
  document.getElementById('next-question').addEventListener('click', function () {
    drafts[questionIndex] = answer.value;
    questionIndex = (questionIndex + 1) % questions.length;
    document.getElementById('warmup-question').textContent = questions[questionIndex];
    answer.value = drafts[questionIndex] || '';
    feedback.textContent = 'Your other answers stay here until you leave or reload this page.';
    updateCount();
  });
  document.getElementById('review-warmup').addEventListener('click', function () {
    if (!answer.value.trim()) {
      feedback.textContent = 'Start with one real example. What happened, what was your task, what did you do, and what was the outcome?';
      answer.focus();
      return;
    }
    feedback.textContent = 'Self-review checklist: Did you explain the situation and your responsibility? Name the actions you took? End with an outcome or lesson? This checklist does not assess the quality of your answer. Use an AI session for personalized feedback.';
  });
})();
