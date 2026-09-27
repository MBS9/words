const state = {
  words: [],
  totalAnswered: 0,
  recentWords: [],
  currentBlock: [],
  blockPosition: 0,
  currentWordIndex: -1,
  answerMode: 'english',
  categoryView: 'mastered',
  speech: {
    supported: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    voice: null,
    hasMandarinVoice: false,
  },
};

const WORD_PROGRESS_STORAGE_KEY = 'word-trainer-progress-v1';

const elements = {
  progress: document.getElementById('progress'),
  masteredCount: document.getElementById('mastered-count'),
  inProgressCount: document.getElementById('in-progress-count'),
  notSeenCount: document.getElementById('not-seen-count'),
  word: document.getElementById('word'),
  replayAudioButton: document.getElementById('replay-audio-button'),
  resetProgressButton: document.getElementById('reset-progress-button'),
  audioStatus: document.getElementById('audio-status'),
  form: document.getElementById('answer-form'),
  answer: document.getElementById('answer'),
  feedback: document.getElementById('feedback'),
  pausePanel: document.getElementById('pause-panel'),
  pauseList: document.getElementById('pause-list'),
  continueButton: document.getElementById('continue-button'),
  answerLabel: document.getElementById('answer-label'),
  categoryWordList: document.getElementById('category-word-list'),
  categoryListEmpty: document.getElementById('category-list-empty'),
  categoryFilterButtons: document.querySelectorAll('[data-category-filter]'),
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u3000\s\p{P}]+/gu, ' ')
    .trim();
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  const chineseIndex = headers.indexOf('chinese');
  const pinyinIndex = headers.indexOf('pinyin');
  const englishIndex = headers.indexOf('english');

  if (chineseIndex === -1 || pinyinIndex === -1 || englishIndex === -1) {
    return [];
  }

  const rows = lines.slice(1);

  return rows
    .map((line) => {
      const cells = line.split(',').map((cell) => cell.trim());
      const chinese = cells[chineseIndex] || '';
      const pinyin = cells[pinyinIndex] || '';
      const english = cells[englishIndex] || '';

      if (!chinese || !english) {
        return null;
      }

      return {
        chinese,
        pinyin,
        english,
      };
    })
    .filter(Boolean);
}

function getAcceptedAnswers(rawAnswer) {
  return rawAnswer
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isCorrectAnswer(submittedAnswer, expectedAnswer) {
  const acceptedAnswers = getAcceptedAnswers(expectedAnswer);
  const normalizedSubmitted = normalizeText(submittedAnswer);

  return acceptedAnswers.some((answer) => normalizeText(answer) === normalizedSubmitted);
}

function normalizePinyin(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCorrectPinyin(submittedAnswer, expectedAnswer) {
  const acceptedAnswers = getAcceptedAnswers(expectedAnswer);
  const normalizedSubmitted = normalizePinyin(submittedAnswer);

  return acceptedAnswers.some((answer) => normalizePinyin(answer) === normalizedSubmitted);
}

function updateProgress() {
  const currentWord = state.words[state.currentWordIndex];
  const currentCorrect = currentWord ? currentWord.correctCount : 0;
  const currentWrong = currentWord ? currentWord.wrongCount : 0;

  elements.progress.textContent = `Block word ${state.blockPosition + 1} of ${state.currentBlock.length} | This word - Correct: ${currentCorrect} | Wrong: ${currentWrong}`;
}

function getWordCategory(word) {
  const attempts = word.correctCount + word.wrongCount;

  if (attempts === 0) {
    return 'notSeen';
  }

  const accuracy = word.correctCount / attempts;

  if (accuracy >= 0.8) {
    return 'mastered';
  }

  if (accuracy >= 0.2) {
    return 'inProgress';
  }

  return 'notSeen';
}

function updateCategorySummary() {
  let mastered = 0;
  let inProgress = 0;
  let notSeen = 0;

  state.words.forEach((word) => {
    const category = getWordCategory(word);

    if (category === 'mastered') {
      mastered += 1;
      return;
    }

    if (category === 'inProgress') {
      inProgress += 1;
      return;
    }

    notSeen += 1;
  });

  elements.masteredCount.textContent = String(mastered);
  elements.inProgressCount.textContent = String(inProgress);
  elements.notSeenCount.textContent = String(notSeen);
}

function getCategoryLabel(category) {
  if (category === 'mastered') {
    return 'Mastered';
  }

  if (category === 'inProgress') {
    return 'In Progress';
  }

  return 'Not Seen';
}

function renderCategoryWordList() {
  const selectedCategory = state.categoryView;
  const wordsInCategory = state.words.filter((word) => getWordCategory(word) === selectedCategory);

  elements.categoryFilterButtons.forEach((button) => {
    const isActive = button.dataset.categoryFilter === selectedCategory;
    button.classList.toggle('active', isActive);
  });

  elements.categoryWordList.innerHTML = '';

  if (!wordsInCategory.length) {
    elements.categoryListEmpty.textContent = `No words in ${getCategoryLabel(selectedCategory)}.`;
    return;
  }

  elements.categoryListEmpty.textContent = '';

  wordsInCategory.forEach((word) => {
    const listItem = document.createElement('li');
    listItem.textContent = `${word.chinese} (${word.pinyin || 'n/a'}) - ${word.english} [C:${word.correctCount} W:${word.wrongCount}]`;
    elements.categoryWordList.appendChild(listItem);
  });
}

function updateAnswerPrompt() {
  if (state.answerMode === 'pinyin') {
    elements.answerLabel.textContent = 'Type the Pinyin:';
    elements.answer.placeholder = 'Enter pinyin';
    return;
  }

  elements.answerLabel.textContent = 'Type the English translation:';
  elements.answer.placeholder = 'Enter English translation';
}

function getWordStorageKey(word) {
  return `${word.chinese}||${word.english}`;
}

function loadStoredProgress() {
  try {
    const raw = window.localStorage.getItem(WORD_PROGRESS_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch (error) {
    return {};
  }
}

function saveProgress() {
  try {
    const payload = {};

    state.words.forEach((word) => {
      if (word.correctCount === 0 && word.wrongCount === 0) {
        return;
      }

      payload[getWordStorageKey(word)] = {
        correctCount: word.correctCount,
        wrongCount: word.wrongCount,
        pinyin: word.pinyin,
      };
    });

    window.localStorage.setItem(WORD_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore persistence failures so quiz flow keeps working.
  }
}

function applyStoredProgress(words) {
  const storedProgress = loadStoredProgress();

  return words.map((word) => {
    const stored = storedProgress[getWordStorageKey(word)] || {};

    return {
      ...word,
      correctCount: Number.isFinite(stored.correctCount) ? Math.max(0, stored.correctCount) : 0,
      wrongCount: Number.isFinite(stored.wrongCount) ? Math.max(0, stored.wrongCount) : 0,
    };
  });
}

function updateAudioStatus(message, isError = false) {
  elements.audioStatus.textContent = message;
  elements.audioStatus.className = isError ? 'audio-status error' : 'audio-status';
}

function pickMandarinVoice() {
  const voices = window.speechSynthesis.getVoices();

  const preferredVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith('zh-cn')) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('zh-tw')) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) ||
    null;

  state.speech.voice = preferredVoice;
  state.speech.hasMandarinVoice = Boolean(preferredVoice);

  if (!state.speech.supported) {
    elements.replayAudioButton.disabled = true;
    updateAudioStatus('Audio unavailable: this browser does not support speech synthesis.', true);
    return;
  }

  if (!state.speech.hasMandarinVoice) {
    elements.replayAudioButton.disabled = true;
    updateAudioStatus('Audio unavailable: no Mandarin voice found on this device.', true);
    return;
  }

  elements.replayAudioButton.disabled = false;
  updateAudioStatus(`Using voice: ${state.speech.voice.name} (${state.speech.voice.lang})`);
}

function initializeSpeech() {
  if (!state.speech.supported) {
    pickMandarinVoice();
    return;
  }

  pickMandarinVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickMandarinVoice);
}

function speakCurrentWord() {
  const currentWord = state.words[state.currentWordIndex];

  if (!currentWord || !state.speech.supported || !state.speech.hasMandarinVoice) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(currentWord.chinese);
  utterance.voice = state.speech.voice;
  utterance.lang = state.speech.voice.lang || 'zh-CN';
  utterance.rate = 0.9;

  utterance.onerror = () => {
    updateAudioStatus('Audio could not be played. Please try Replay Audio.', true);
  };

  window.speechSynthesis.speak(utterance);
}

function shuffleArray(items) {
  const array = [...items];

  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

function pickRandomDistinct(source, count, excludeSet = new Set()) {
  const filtered = source.filter((item) => !excludeSet.has(item));
  return shuffleArray(filtered).slice(0, Math.max(0, count));
}

function getWordPools() {
  const pools = {
    inProgress: [],
    notSeen: [],
  };

  state.words.forEach((word, index) => {
    const category = getWordCategory(word);

    if (category === 'mastered') {
      return;
    }

    if (category === 'inProgress') {
      pools.inProgress.push(index);
      return;
    }

    pools.notSeen.push(index);
  });

  return pools;
}

function buildNextBlock() {
  const pools = getWordPools();
  const selected = [];
  const selectedSet = new Set();

  if (pools.inProgress.length > 20) {
    const inProgressOnly = pickRandomDistinct(pools.inProgress, 7);
    state.currentBlock = shuffleArray(inProgressOnly);
    state.blockPosition = 0;
    return;
  }

  const inProgressTarget = Math.min(3, pools.inProgress.length);
  const selectedInProgress = pickRandomDistinct(pools.inProgress, inProgressTarget);

  selectedInProgress.forEach((index) => {
    selected.push(index);
    selectedSet.add(index);
  });

  const notSeenTarget = 7 - selected.length;
  const selectedNotSeen = pickRandomDistinct(pools.notSeen, notSeenTarget, selectedSet);

  selectedNotSeen.forEach((index) => {
    selected.push(index);
    selectedSet.add(index);
  });

  if (selected.length < 7) {
    const fallback = pickRandomDistinct(
      [...pools.notSeen, ...pools.inProgress],
      7 - selected.length,
      selectedSet,
    );

    fallback.forEach((index) => {
      selected.push(index);
      selectedSet.add(index);
    });
  }

  state.currentBlock = shuffleArray(selected);
  state.blockPosition = 0;
}

function ensureCurrentWord() {
  if (!state.currentBlock.length || state.blockPosition >= state.currentBlock.length) {
    buildNextBlock();
  }

  if (!state.currentBlock.length) {
    return false;
  }

  state.currentWordIndex = state.currentBlock[state.blockPosition];
  return true;
}

function showCurrentWord() {
  if (!ensureCurrentWord()) {
    elements.progress.textContent = 'No words available';
    elements.word.textContent = '-';
    return;
  }

  const word = state.words[state.currentWordIndex];

  if (!word) {
    elements.progress.textContent = 'No words available';
    elements.word.textContent = '-';
    return;
  }

  updateProgress();
  updateCategorySummary();
  renderCategoryWordList();
  state.answerMode = 'english';
  updateAnswerPrompt();
  elements.form.classList.remove('hidden');
  elements.pausePanel.classList.add('hidden');
  elements.word.textContent = word.chinese;
  elements.answer.value = '';
  elements.answer.focus();
  elements.feedback.textContent = '';
  elements.feedback.className = 'feedback';
  speakCurrentWord();
}

function showPauseReview() {
  if (state.speech.supported) {
    window.speechSynthesis.cancel();
  }

  elements.form.classList.add('hidden');
  elements.pausePanel.classList.remove('hidden');
  elements.word.textContent = 'Review Break';
  elements.feedback.textContent = '';
  elements.feedback.className = 'feedback';

  elements.pauseList.innerHTML = '';
  state.recentWords.forEach((word) => {
    const listItem = document.createElement('li');
    listItem.textContent = `${word.chinese} - ${word.english}`;
    elements.pauseList.appendChild(listItem);
  });
}

function handleSubmit(event) {
  event.preventDefault();

  const currentWord = state.words[state.currentWordIndex];
  if (!currentWord) {
    return;
  }

  const submittedAnswer = elements.answer.value.trim();

  if (!submittedAnswer) {
    elements.feedback.textContent = 'Please enter an answer before continuing.';
    elements.feedback.className = 'feedback incorrect';
    return;
  }

  if (state.answerMode === 'english') {
    if (isCorrectAnswer(submittedAnswer, currentWord.english)) {
      currentWord.correctCount += 1;
      saveProgress();
      state.answerMode = 'pinyin';
      updateAnswerPrompt();
      elements.feedback.textContent = 'English correct. Now type the Pinyin.';
      elements.feedback.className = 'feedback correct';
      elements.answer.value = '';
      elements.answer.focus();
      updateCategorySummary();
      renderCategoryWordList();
      return;
    }

    currentWord.wrongCount += 1;
    saveProgress();
    elements.feedback.textContent = `Not quite. The answer is: ${currentWord.english}`;
    elements.feedback.className = 'feedback incorrect';
    updateCategorySummary();
    renderCategoryWordList();
    elements.answer.value = '';
    elements.answer.focus();
    return;
  }

  if (!currentWord.pinyin || isCorrectPinyin(submittedAnswer, currentWord.pinyin)) {
    elements.feedback.textContent = `Pinyin correct: ${currentWord.pinyin || 'n/a'}`;
    elements.feedback.className = 'feedback correct';
  } else {
    elements.feedback.textContent = `Pinyin not quite. Correct pinyin: ${currentWord.pinyin}`;
    elements.feedback.className = 'feedback incorrect';
    elements.answer.value = '';
    elements.answer.focus();
    return;
  }

  state.totalAnswered += 1;
  state.recentWords.push({
    chinese: currentWord.chinese,
    english: currentWord.english,
  });

  if (state.recentWords.length > 7) {
    state.recentWords.shift();
  }

  updateCategorySummary();
  renderCategoryWordList();

  state.blockPosition += 1;

  if (state.blockPosition >= state.currentBlock.length) {
    setTimeout(showPauseReview, 800);
    return;
  }

  setTimeout(showCurrentWord, 800);
}

function handleContinue() {
  showCurrentWord();
}

function handleReplayAudio() {
  speakCurrentWord();
}

function handleCategoryFilterClick(event) {
  const category = event.currentTarget.dataset.categoryFilter;
  if (!category) {
    return;
  }

  state.categoryView = category;
  renderCategoryWordList();
}

function handleResetProgress() {
  const confirmed = window.confirm('Reset all saved word progress on this device?');
  if (!confirmed) {
    return;
  }

  try {
    window.localStorage.removeItem(WORD_PROGRESS_STORAGE_KEY);
  } catch (error) {
    // Ignore storage failures and still reset in-memory state.
  }

  state.words.forEach((word) => {
    word.correctCount = 0;
    word.wrongCount = 0;
  });

  state.totalAnswered = 0;
  state.recentWords = [];
  state.currentBlock = [];
  state.blockPosition = 0;
  state.currentWordIndex = -1;
  state.answerMode = 'english';
  state.categoryView = 'mastered';

  updateCategorySummary();
  renderCategoryWordList();
  showCurrentWord();
  elements.feedback.textContent = 'Progress reset.';
  elements.feedback.className = 'feedback correct';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  });
}

async function loadWords() {
  try {
    const response = await fetch('words.csv');

    if (!response.ok) {
      throw new Error(`CSV request failed with status ${response.status}`);
    }

    const csvText = await response.text();
    const parsedWords = parseCsv(csvText);

    if (!parsedWords.length) {
      throw new Error('No valid rows were found in the CSV file.');
    }

    state.words = applyStoredProgress(parsedWords);
    elements.progress.textContent = `Loading ${state.words.length} words...`;
    updateCategorySummary();
    renderCategoryWordList();
    showCurrentWord();
  } catch (error) {
    elements.progress.textContent = 'Error loading words';
    elements.word.textContent = 'Unable to load the vocabulary list';
    elements.feedback.textContent = error.message;
    elements.feedback.className = 'feedback incorrect';
  }
}

elements.form.addEventListener('submit', handleSubmit);
elements.continueButton.addEventListener('click', handleContinue);
elements.replayAudioButton.addEventListener('click', handleReplayAudio);
elements.resetProgressButton.addEventListener('click', handleResetProgress);
elements.categoryFilterButtons.forEach((button) => {
  button.addEventListener('click', handleCategoryFilterClick);
});
registerServiceWorker();
initializeSpeech();
loadWords();
