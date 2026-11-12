/**
 * Video Summarizer - DevFest Sherbrooke & Eastern Townships Frontend Controller
 * Full Bilingual Interface (FR / EN / BILINGUE) with Live NDJSON Streaming & Accessibility
 */

(() => {
    const state = {
        selectedModel: 'gemma4',
        selectedOllamaVariant: 'gemma4:latest',
        availableOllamaModels: [],
        currentSourceMode: 'youtube', // 'youtube' or 'file'
        selectedFile: null,
        currentVideoObjectUrl: null,
        currentSummaryMarkdown: '',
        currentVideoData: null,
        debounceTimer: null,
        previewAbortController: null,
        summarizeAbortController: null,
        currentLang: 'bi', // 'fr', 'en', 'bi'
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Sanitize untrusted Markdown HTML using native Sanitizer API (`setHTML`)
     * with aligned DOMPurify fallback when native support is absent.
     */
    function safeSetHTML(el, rawHtml) {
        if (!el) return;
        if ('setHTML' in Element.prototype) {
            el.setHTML(rawHtml);
        } else if (window.DOMPurify) {
            el.innerHTML = window.DOMPurify.sanitize(rawHtml, {
                ALLOW_ARIA_ATTR: false,
                ALLOW_DATA_ATTR: false,
                KEEP_CONTENT: false,
            });
        } else {
            el.textContent = rawHtml;
        }
    }

    const translations = {
        fr: {
            pageTitle: "Sommaire Vidéo IA | DevFest Sherbrooke",
            langLabel: "Langue :",
            tablistLabel: "Mode de source média",
            titlePrefix: "Sommaire Vidéo",
            subtitle: "L'intelligence artificielle au cœur des Cantons-de-l'Est • Propulsé par DevFest Sherbrooke",
            tabYoutube: "Lien YouTube",
            tabUpload: "Fichier Vidéo ou Audio",
            labelYoutube: "Lien de la vidéo YouTube",
            btnPaste: "Coller",
            labelUpload: "Fichier vidéo ou audio local",
            dropTextMain: "<strong>Cliquez pour parcourir</strong> ou glissez-déposez votre fichier ici",
            dropTextSub: "Formats acceptés : .mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a",
            tagMp4Loaded: "Média Prêt",
            tagVideoReady: "Vidéo Prête",
            labelSongMode: "Mode Chanson : extraction des paroles (2e passe)",
            tagSongPass: "Paroles & Audio",
            descSongMode: "Cochez cette case si le lien ou le fichier est une chanson afin d'extraire les paroles complètes et d'analyser les thèmes musicaux.",
            labelModelSelect: "Sélectionnez le modèle d'IA",
            tagLocalServer: "Local • Cantons",
            descGemma4: "Modèle local privé via Ollama (gemma4:12b / latest).",
            descFlash: "Exécution ultra-rapide et synthèse équilibrée.",
            descArgon: "Raisonnement approfondi et analyse multimodale.",
            tagCarbon: "Pointe • 1M",
            descCarbon: "Raisonnement de pointe maximal (1M contexte).",
            labelLocalVariant: "Variante locale Gemma 4 :",
            btnRefreshModels: "Actualiser",
            noteLocalServer: "Découvert depuis le serveur Ollama local.",
            labelCarbonThinking: "Niveau de réflexion Gemini 4 Carbon (API Interactions) :",
            noteCarbonThinking: "Gemini 4 Carbon engage un raisonnement maximal par défaut. Vous pouvez ajuster le niveau de réflexion (Faible, Moyen, Élevé) via thinking_level dans l'API Interactions.",
            labelArgonThinking: "Niveau de réflexion Gemini 4 Argon (API Interactions) :",
            optThinkingHigh: "Élevé (Raisonnement approfondi • Recommandé)",
            optThinkingMedium: "Moyen (Équilibré)",
            optThinkingLow: "Faible (Rapide)",
            noteArgonThinking: "Contrôle la profondeur de raisonnement via l'API Interactions de Google.",
            labelContext: "Contexte additionnel et attentes",
            tagOptional: "(Optionnel)",
            contextPlaceholder: "Ex. : Mettre l'accent sur les extraits de code, lister 5 points clés pour développeurs, vulgariser pour des débutants...",
            toggleKeyText: "Clé API Gemini personnalisée (optionnelle)",
            apiKeyPlaceholder: "AIzaSy... (Laisser vide pour utiliser la clé du serveur)",
            helpApiKey: "Optionnel. Votre clé ne sera jamais enregistrée sur le serveur.",
            btnSubmit: "Générer le sommaire",
            btnAnalyzing: "Analyse en cours...",
            btnCancel: "Annuler",
            loadingTitle: "Extraction de la transcription et génération du sommaire...",
            stageTranscript: "Étape 1/2 : Extraction des sous-titres ou de l'audio...",
            stageFrames: "Étape 1/2 : Extraction d'images clés visuelles de la vidéo...",
            stageLlm: "Étape 2/2 : Rédaction du sommaire en direct...",
            loadingSub: "Traitement en cours aux couleurs de Sherbrooke et des Cantons-de-l'Est.",
            errorTitleDefault: "Impossible de générer le sommaire",
            btnCopy: "Copier le résumé",
            btnCopied: "Copié !",
            btnDownload: "Télécharger .md",
            btnViewTranscript: "Voir la transcription",
            btnHideTranscript: "Masquer la transcription",
            titleTranscript: "Transcription complète",
            footerText: "Conçu pour le <strong>DevFest Sherbrooke</strong> 🌲⛰️ • Cantons-de-l'Est, Québec • Propulsé par <strong>Tokens &amp; Caféine</strong>",
            transcriptLines: "lignes",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        },
        en: {
            pageTitle: "AI Video Summarizer | DevFest Sherbrooke",
            langLabel: "Language:",
            tablistLabel: "Media source mode",
            titlePrefix: "AI Video Summarizer",
            subtitle: "AI from the Heart of the Eastern Townships • Powered by DevFest Sherbrooke",
            tabYoutube: "YouTube Link",
            tabUpload: "Upload Video or Audio",
            labelYoutube: "YouTube Video Link",
            btnPaste: "Paste",
            labelUpload: "Local Video or Audio File",
            dropTextMain: "<strong>Click to browse</strong> or drag and drop your file here",
            dropTextSub: "Supported formats: .mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a",
            tagMp4Loaded: "Media Ready",
            tagVideoReady: "Video Ready",
            labelSongMode: "Song Mode: 2nd-pass lyrics extraction",
            tagSongPass: "Lyrics & Audio",
            descSongMode: "Check this box when the link or file is a song to extract the full lyrics and analyze the musical themes.",
            labelModelSelect: "Select AI Model",
            tagLocalServer: "Local • Townships",
            descGemma4: "Private local model via Ollama (gemma4:12b / latest).",
            descFlash: "Ultra-fast execution and balanced summary.",
            descArgon: "Deep reasoning and multimodal analysis.",
            tagCarbon: "Frontier • 1M",
            descCarbon: "Maximum frontier reasoning depth (1M context).",
            labelLocalVariant: "Select Local Gemma 4 Variant:",
            btnRefreshModels: "Refresh",
            noteLocalServer: "Loaded from local Ollama server.",
            labelCarbonThinking: "Gemini 4 Carbon Reasoning Depth (Interactions API):",
            noteCarbonThinking: "Gemini 4 Carbon engages deep frontier reasoning by default. You can adjust the reasoning depth (Low, Medium, High) via thinking_level in the Google Interactions API.",
            labelArgonThinking: "Gemini 4 Argon Reasoning Depth (Interactions API):",
            optThinkingHigh: "High (Deep Reasoning • Recommended)",
            optThinkingMedium: "Medium (Balanced)",
            optThinkingLow: "Low (Fast)",
            noteArgonThinking: "Controls reasoning depth (Low, Medium, High) for Gemini 4 Argon via thinking_level in the Google Interactions API.",
            labelContext: "Extra Context & Expectations",
            tagOptional: "(Optional)",
            contextPlaceholder: "E.g. Focus on code examples, list top 5 takeaways for developers, or summarize for beginners...",
            toggleKeyText: "Custom Gemini API Key (optional)",
            apiKeyPlaceholder: "AIzaSy... (Leave blank to use the server key)",
            helpApiKey: "Optional. Your key will never be stored on the server.",
            btnSubmit: "Generate Summary",
            btnAnalyzing: "Analyzing...",
            btnCancel: "Cancel",
            loadingTitle: "Extracting transcript and generating summary...",
            stageTranscript: "Step 1/2: Extracting captions or audio track...",
            stageFrames: "Step 1/2: Extracting visual keyframes from video...",
            stageLlm: "Step 2/2: Streaming summary live...",
            loadingSub: "Processing with Eastern Townships tech energy and Sherbrooke vibes.",
            errorTitleDefault: "Unable to generate summary",
            btnCopy: "Copy Summary",
            btnCopied: "Copied!",
            btnDownload: "Download .md",
            btnViewTranscript: "View Transcript",
            btnHideTranscript: "Hide Transcript",
            titleTranscript: "Full Transcript",
            footerText: "Built for <strong>DevFest Sherbrooke</strong> 🌲⛰️ • Eastern Townships, Quebec • Powered by <strong>Tokens &amp; Caffeine</strong>",
            transcriptLines: "lines",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        },
        bi: {
            pageTitle: "Sommaire Vidéo IA • AI Video Summarizer | DevFest Sherbrooke",
            langLabel: "Langue / Language:",
            tablistLabel: "Source média / Media source",
            titlePrefix: "Sommaire Vidéo",
            subtitle: "L'intelligence artificielle au cœur des Cantons-de-l'Est • AI Video Summarizer",
            tabYoutube: "Lien YouTube / YouTube Link",
            tabUpload: "Fichier Vidéo ou Audio / Upload Media",
            labelYoutube: "Lien de la vidéo YouTube / YouTube Video Link",
            btnPaste: "Coller / Paste",
            labelUpload: "Fichier vidéo ou audio local / Local Video or Audio File",
            dropTextMain: "<strong>Cliquez pour parcourir</strong> ou glissez-déposez un fichier • <strong>Click to browse</strong> or drag &amp; drop",
            dropTextSub: "Formats acceptés / Supported: .mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a",
            tagMp4Loaded: "Média Prêt / Media Ready",
            tagVideoReady: "Vidéo Prête / Video Ready",
            labelSongMode: "Mode Chanson (2e passe paroles) / Song Mode (2nd-pass lyrics)",
            tagSongPass: "Paroles / Lyrics",
            descSongMode: "Cochez si le lien ou le fichier est une chanson pour extraire les paroles / Check if the input is a song to extract full lyrics.",
            labelModelSelect: "Sélectionnez le modèle d'IA / Select AI Model",
            tagLocalServer: "Local • Cantons / Townships",
            descGemma4: "Modèle local privé via Ollama / Private local model (gemma4:12b / latest).",
            descFlash: "Exécution ultra-rapide et synthèse équilibrée / Fast &amp; balanced summary.",
            descArgon: "Raisonnement approfondi &amp; analyse complexe / Deep multimodal reasoning.",
            tagCarbon: "Pointe / Frontier • 1M",
            descCarbon: "Raisonnement de pointe maximal / Maximum frontier reasoning (1M).",
            labelLocalVariant: "Variante locale Gemma 4 / Local Variant:",
            btnRefreshModels: "Actualiser / Refresh",
            noteLocalServer: "Découvert depuis le serveur Ollama local / Loaded from local Ollama.",
            labelCarbonThinking: "Niveau de réflexion Gemini 4 Carbon / Reasoning Depth (Interactions API):",
            noteCarbonThinking: "Gemini 4 Carbon applique un raisonnement maximal par défaut / Engages deep frontier reasoning by default (Low, Medium, High via thinking_level).",
            labelArgonThinking: "Niveau de réflexion Gemini 4 Argon / Reasoning Depth (Interactions API):",
            optThinkingHigh: "Élevé / High (Raisonnement approfondi • Recommandé / Recommended)",
            optThinkingMedium: "Moyen / Medium (Équilibré / Balanced)",
            optThinkingLow: "Faible / Low (Rapide / Fast)",
            noteArgonThinking: "Contrôle la profondeur de raisonnement pour Gemini 4 Argon / Controls reasoning depth (Low, Medium, High via thinking_level).",
            labelContext: "Contexte additionnel et attentes / Extra Context &amp; Expectations",
            tagOptional: "(Optionnel / Optional)",
            contextPlaceholder: "Ex. : Mettre l'accent sur le code, 5 points clés... / E.g. Focus on code, 5 takeaways...",
            toggleKeyText: "Clé API Gemini personnalisée (optionnelle) / Custom Gemini API Key",
            apiKeyPlaceholder: "AIzaSy... (Laisser vide pour la clé serveur / Leave blank for server key)",
            helpApiKey: "Optionnel. Votre clé ne sera jamais enregistrée / Never stored on server.",
            btnSubmit: "Générer le sommaire / Generate Summary",
            btnAnalyzing: "Analyse en cours / Analyzing...",
            btnCancel: "Annuler / Cancel",
            loadingTitle: "Extraction de la transcription et génération du sommaire / Generating summary...",
            stageTranscript: "Étape 1/2 : Extraction transcription / Extracting transcript...",
            stageFrames: "Étape 1/2 : Lecture visuelle de la vidéo / Extracting video keyframes...",
            stageLlm: "Étape 2/2 : Génération en direct / Streaming summary...",
            loadingSub: "Traitement en cours aux couleurs de Sherbrooke et des Cantons-de-l'Est.",
            errorTitleDefault: "Impossible de générer le sommaire / Unable to generate summary",
            btnCopy: "Copier / Copy",
            btnCopied: "Copié ! / Copied!",
            btnDownload: "Télécharger .md / Download .md",
            btnViewTranscript: "Voir la transcription / View Transcript",
            btnHideTranscript: "Masquer la transcription / Hide Transcript",
            titleTranscript: "Transcription complète / Full Transcript",
            footerText: "Conçu pour le <strong>DevFest Sherbrooke</strong> 🌲⛰️ • Cantons-de-l'Est, Québec • Propulsé par <strong>Tokens &amp; Caféine</strong>",
            transcriptLines: "lignes / lines",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        }
    };

    function formatOllamaOptionLabel(m) {
        let labelText = m.name;
        if (m.parameter_size) {
            const isPowerful = m.name.includes('12b') || m.name.includes('26b') || m.name.includes('27b');
            const isFast = m.name.includes('latest') || m.name.includes('8b');
            if (isPowerful) {
                const desc = state.currentLang === 'en' ? 'More Powerful' : (state.currentLang === 'fr' ? 'Plus puissant' : 'Plus puissant / More Powerful');
                labelText += ` (${m.parameter_size} - ${desc})`;
            } else if (isFast) {
                const desc = state.currentLang === 'en' ? 'Fast & Balanced' : (state.currentLang === 'fr' ? 'Rapide & équilibré' : 'Rapide & équilibré / Fast & Balanced');
                labelText += ` (${m.parameter_size} - ${desc})`;
            } else {
                labelText += ` (${m.parameter_size})`;
            }
        }
        return labelText;
    }

    function renderOllamaSelectOptions() {
        const selectEl = document.getElementById('ollama-model-select');
        if (!selectEl || state.availableOllamaModels.length === 0) return;

        const currentVal = state.selectedOllamaVariant || selectEl.value;
        selectEl.innerHTML = '';
        let preferredFound = false;

        state.availableOllamaModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = formatOllamaOptionLabel(m);
            if (m.name === currentVal || (!currentVal && m.name === 'gemma4:latest')) {
                opt.selected = true;
                state.selectedOllamaVariant = m.name;
                preferredFound = true;
            }
            selectEl.appendChild(opt);
        });

        if (!preferredFound && state.availableOllamaModels.length > 0) {
            selectEl.selectedIndex = 0;
            state.selectedOllamaVariant = state.availableOllamaModels[0].name;
        }
    }

    function updateOllamaModelNote(modelName) {
        const noteEl = document.getElementById('ollama-model-note');
        if (!noteEl) return;

        const found = state.availableOllamaModels.find(m => m.name === modelName);
        const isEn = state.currentLang === 'en';
        const isFr = state.currentLang === 'fr';
        const safeModelName = escapeHtml(modelName);

        if (found) {
            const prefix = isEn ? "Active local model: " : (isFr ? "Modèle local actif : " : "Modèle local actif / Active model: ");
            const sizeLabel = isEn ? "Size:" : (isFr ? "Taille :" : "Taille / Size:");
            const unitLabel = isFr ? "Go" : "GB";
            let text = `${prefix}<strong>${escapeHtml(found.name)}</strong>`;
            if (found.parameter_size) text += ` • ${sizeLabel} ${escapeHtml(found.parameter_size)}`;
            if (found.size_gb) text += ` (${escapeHtml(found.size_gb)} ${unitLabel})`;
            noteEl.innerHTML = text;
        } else {
            noteEl.innerHTML = `<strong>${safeModelName}</strong> (Ollama Local)`;
        }
    }

    function syncTranscriptToggleText() {
        const drawer = document.getElementById('transcript-drawer');
        const toggleBtn = document.getElementById('btn-toggle-transcript');
        const toggleText = document.getElementById('transcript-toggle-text');
        const dict = translations[state.currentLang];
        if (!drawer || !toggleText || !dict) return;

        const isOpen = drawer.open;
        toggleText.textContent = isOpen ? dict.btnHideTranscript : dict.btnViewTranscript;
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', String(isOpen));
        }
    }

    function setLanguage(lang) {
        if (!translations[lang]) lang = 'bi';
        state.currentLang = lang;
        try {
            localStorage.setItem('devfest_lang', lang);
        } catch (_) {
            // Ignore private-browsing storage restrictions
        }

        // Sync <html lang> and <title> for screen readers and browser tabs
        document.documentElement.lang = (lang === 'en') ? 'en' : 'fr';
        const dict = translations[lang];
        if (dict.pageTitle) {
            document.title = dict.pageTitle;
        }

        const tablist = document.getElementById('source-tablist');
        if (tablist && dict.tablistLabel) {
            tablist.setAttribute('aria-label', dict.tablistLabel);
        }

        ['fr', 'bi', 'en'].forEach(l => {
            const btn = document.getElementById(`lang-${l}`);
            if (btn) {
                const isActive = (l === lang);
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            }
        });

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key]) {
                if (el.tagName === 'OPTION') {
                    el.text = dict[key];
                    el.textContent = dict[key];
                } else {
                    el.innerHTML = dict[key];
                }
            }
        });

        const contextInput = document.getElementById('custom-context');
        if (contextInput && dict.contextPlaceholder) {
            contextInput.placeholder = dict.contextPlaceholder;
        }

        const ytInput = document.getElementById('youtube-url');
        if (ytInput && dict.ytPlaceholder) {
            ytInput.placeholder = dict.ytPlaceholder;
        }

        const apiKeyInput = document.getElementById('user-api-key');
        if (apiKeyInput && dict.apiKeyPlaceholder) {
            apiKeyInput.placeholder = dict.apiKeyPlaceholder;
        }

        renderOllamaSelectOptions();
        updateOllamaModelNote(state.selectedOllamaVariant);
        updateThinkingContainer();
        syncTranscriptToggleText();
    }

    async function loadOllamaModels(isManualRefresh = false) {
        const refreshIcon = document.getElementById('refresh-icon');
        if (refreshIcon && isManualRefresh) {
            refreshIcon.classList.add('fa-spin');
        }

        try {
            const res = await fetch('/api/ollama/models');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.models && data.models.length > 0) {
                    state.availableOllamaModels = data.models;
                    renderOllamaSelectOptions();
                    updateOllamaModelNote(state.selectedOllamaVariant);
                }
            }
        } catch (err) {
            console.warn("Could not load local Ollama models:", err);
        } finally {
            if (refreshIcon) {
                refreshIcon.classList.remove('fa-spin');
            }
        }
    }

    function switchSourceMode(mode, { focusTab = false } = {}) {
        state.currentSourceMode = mode;

        const tabYt = document.getElementById('tab-yt');
        const tabFile = document.getElementById('tab-file');
        const ytContainer = document.getElementById('yt-input-container');
        const fileContainer = document.getElementById('file-input-container');
        const previewCard = document.getElementById('video-preview-card');

        const isYt = (mode === 'youtube');
        const tabs = [
            { el: tabYt, selected: isYt },
            { el: tabFile, selected: !isYt },
        ];

        tabs.forEach(({ el, selected }) => {
            if (!el) return;
            el.classList.toggle('active', selected);
            el.setAttribute('aria-selected', String(selected));
            el.toggleAttribute('focusgroupstart', selected);
            if (!Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
                el.setAttribute('tabindex', selected ? '0' : '-1');
            }
            if (selected) {
                if (focusTab) el.focus();
                try {
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
                } catch (_) {
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            }
        });

        if (ytContainer) ytContainer.hidden = !isYt;
        if (fileContainer) fileContainer.hidden = isYt;

        if (previewCard) {
            const urlInput = document.getElementById('youtube-url');
            if (isYt && urlInput && urlInput.value.trim()) {
                previewCard.classList.remove('hidden');
            } else {
                previewCard.classList.add('hidden');
            }
        }
    }

    function handleFileSelected(files) {
        if (!files || files.length === 0) return;

        const file = files[0];
        const isAudio = file.type.startsWith('audio/') ||
            Boolean(file.name.match(/\.(mp3|wav|m4a|flac|ogg|aac)$/i));
        const isVideo = file.type.startsWith('video/') ||
            Boolean(file.name.match(/\.(mp4|mov|mkv|webm|avi|m4v)$/i));

        if (!isAudio && !isVideo) {
            showError(
                state.currentLang === 'en'
                    ? "Please select a valid video or audio file (.mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a)."
                    : "Veuillez sélectionner un fichier vidéo ou audio valide (.mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a)."
            );
            return;
        }

        hideError();
        state.selectedFile = file;

        if (isAudio) {
            const songCheckbox = document.getElementById('song-mode-checkbox');
            const songCard = document.getElementById('song-mode-card');
            if (songCheckbox && !songCheckbox.checked) {
                songCheckbox.checked = true;
                if (songCard) songCard.classList.add('active');
            }
        }

        document.getElementById('local-filename').textContent = file.name;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        document.getElementById('local-filesize').innerHTML = `<i class="fa-solid fa-hard-drive" aria-hidden="true"></i> ${escapeHtml(sizeMb)} MB`;

        const playerWrapper = document.getElementById('local-player-wrapper');
        if (playerWrapper) {
            playerWrapper.classList.toggle('audio-only', isAudio);
        }

        const localVideo = document.getElementById('local-video-player');
        if (localVideo) {
            if (state.currentVideoObjectUrl) {
                URL.revokeObjectURL(state.currentVideoObjectUrl);
            }
            state.currentVideoObjectUrl = URL.createObjectURL(file);
            localVideo.src = state.currentVideoObjectUrl;
            localVideo.load();
        }

        document.getElementById('local-file-card').classList.remove('hidden');
    }

    function updateThinkingContainer() {
        const container = document.getElementById('argon-thinking-container');
        if (!container) return;
        const isGemini4 = (state.selectedModel === 'argon' || state.selectedModel === 'carbon');
        container.classList.toggle('hidden', !isGemini4);
        if (!isGemini4) return;

        const dict = translations[state.currentLang] || translations.bi;
        const labelEl = document.getElementById('argon-thinking-label-text');
        const noteEl = document.getElementById('argon-thinking-note');

        if (state.selectedModel === 'carbon') {
            if (labelEl) {
                labelEl.setAttribute('data-i18n', 'labelCarbonThinking');
                if (dict.labelCarbonThinking) labelEl.textContent = dict.labelCarbonThinking;
            }
            if (noteEl) {
                noteEl.setAttribute('data-i18n', 'noteCarbonThinking');
                if (dict.noteCarbonThinking) noteEl.textContent = dict.noteCarbonThinking;
            }
        } else {
            if (labelEl) {
                labelEl.setAttribute('data-i18n', 'labelArgonThinking');
                if (dict.labelArgonThinking) labelEl.textContent = dict.labelArgonThinking;
            }
            if (noteEl) {
                noteEl.setAttribute('data-i18n', 'noteArgonThinking');
                if (dict.noteArgonThinking) noteEl.textContent = dict.noteArgonThinking;
            }
        }
    }

    function selectModel(modelKey) {
        state.selectedModel = modelKey;

        document.querySelectorAll('.model-card').forEach(card => card.classList.remove('active'));
        const activeCard = document.getElementById(`card-${modelKey}`);
        if (activeCard) {
            activeCard.classList.add('active');
            const radio = activeCard.querySelector('input[type="radio"]');
            if (radio && !radio.checked) radio.checked = true;
        }

        const ollamaVariantBox = document.getElementById('ollama-variant-container');
        if (ollamaVariantBox) {
            ollamaVariantBox.classList.toggle('hidden', modelKey !== 'gemma4');
        }

        updateThinkingContainer();
    }

    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                const urlInput = document.getElementById('youtube-url');
                urlInput.value = text.trim();
                fetchVideoPreview(urlInput.value);
            }
        } catch (_) {
            const urlInput = document.getElementById('youtube-url');
            if (urlInput) urlInput.focus();
            showError(
                state.currentLang === 'en'
                    ? "Clipboard permission denied. Please paste directly using Ctrl+V / Cmd+V."
                    : "Accès au presse-papiers refusé. Veuillez coller directement avec Ctrl+V / Cmd+V."
            );
        }
    }

    async function fetchVideoPreview(url) {
        if (state.currentSourceMode !== 'youtube') return;

        if (state.previewAbortController) {
            state.previewAbortController.abort();
            state.previewAbortController = null;
        }

        const previewCard = document.getElementById('video-preview-card');
        const embedIframe = document.getElementById('yt-embed-player');

        if (!url || !url.trim()) {
            previewCard.classList.add('hidden');
            if (embedIframe) embedIframe.src = "";
            return;
        }

        const controller = new AbortController();
        state.previewAbortController = controller;

        try {
            const res = await fetch('/api/video-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim() }),
                signal: controller.signal,
            });

            if (controller.signal.aborted) return;

            if (res.ok) {
                const data = await res.json();
                if (data.success && data.metadata && data.video_id) {
                    document.getElementById('preview-title').textContent = data.metadata.title;
                    document.getElementById('preview-author').innerHTML = `<i class="fa-solid fa-user-circle" aria-hidden="true"></i> ${escapeHtml(data.metadata.author_name)}`;

                    const previewThumb = document.getElementById('preview-thumb');
                    if (previewThumb) {
                        const fallback = `https://i.ytimg.com/vi/${encodeURIComponent(data.video_id)}/hqdefault.jpg`;
                        previewThumb.src = data.metadata.thumbnail_url || fallback;
                        previewThumb.onerror = function () {
                            if (previewThumb.src !== fallback) {
                                previewThumb.src = fallback;
                            } else {
                                previewThumb.src = '/static/video-placeholder.png';
                            }
                        };
                    }

                    const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(data.video_id)}?autoplay=0&rel=0`;
                    if (embedIframe && embedIframe.src !== embedUrl) {
                        embedIframe.src = embedUrl;
                    }

                    previewCard.classList.remove('hidden');
                    return;
                }
            }
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.warn("Preview fetch error:", err);
        }
        previewCard.classList.add('hidden');
        if (embedIframe) embedIframe.src = "";
    }

    function populateResultHeader(metadata, transcriptInfo, modelUsedLabel) {
        const dict = translations[state.currentLang];
        const modelBadge = document.getElementById('res-model-used');
        if (modelBadge && modelUsedLabel) {
            let displayLabel = modelUsedLabel;
            const thinkingSelect = document.getElementById('argon-thinking-select');
            const thinkingLevel = thinkingSelect ? thinkingSelect.value : 'high';
            const isFr = state.currentLang === 'fr';
            const isEn = state.currentLang === 'en';
            const reasonPrefix = isFr ? 'réflexion' : (isEn ? 'reasoning' : 'réflexion / reasoning');
            if (modelUsedLabel === 'carbon' || modelUsedLabel === 'gemini-4-carbon') {
                displayLabel = `Gemini (gemini-4-carbon • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel === 'argon' || modelUsedLabel === 'gemini-4-argon') {
                displayLabel = `Gemini (gemini-4-argon • ${reasonPrefix}: ${thinkingLevel})`;
            }
            modelBadge.textContent = displayLabel;
        }

        if (transcriptInfo) {
            const langInfo = document.getElementById('res-lang-info');
            const langName = escapeHtml(transcriptInfo.language || (state.currentLang === 'en' ? 'English' : 'Français'));
            const segCount = Number(transcriptInfo.segment_count) || 0;
            langInfo.innerHTML = `<i class="fa-solid fa-closed-captioning" aria-hidden="true"></i> ${langName} (${segCount} ${escapeHtml(dict.transcriptLines)})`;

            const transcriptEl = document.getElementById('transcript-text-content');
            if (transcriptEl) {
                transcriptEl.textContent = transcriptInfo.full_transcript || (
                    state.currentLang === 'en' ? "Transcript details unavailable." : "Détails de la transcription indisponibles."
                );
            }
        }

        const meta = metadata || {};
        const resThumb = document.getElementById('res-thumb');
        const videoId = meta.video_id || '';
        const fallback = videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : '/static/video-placeholder.png';
        const primaryThumb = meta.thumbnail_url || fallback;

        if (resThumb) {
            resThumb.src = primaryThumb;
            resThumb.onerror = function () {
                if (resThumb.src !== fallback) {
                    resThumb.src = fallback;
                } else {
                    resThumb.src = '/static/video-placeholder.png';
                }
            };
        }
        document.getElementById('res-title').textContent = meta.title || 'Video Summary';
        document.getElementById('res-author').textContent = meta.author_name || '';
    }

    function renderMarkdownIntoSummary(markdownText) {
        const summaryBox = document.getElementById('summary-content');
        if (!summaryBox) return;
        if (window.marked) {
            const rawHtml = window.marked.parse(markdownText);
            safeSetHTML(summaryBox, rawHtml);
        } else {
            summaryBox.textContent = markdownText;
        }
    }

    function classifyAndShowModelError(errMsg) {
        const dict = translations[state.currentLang];
        let errTitle = dict.errorTitleDefault;
        if (errMsg.includes("Whisper") || errMsg.includes("Offline Speech Model")) {
            errTitle = state.currentLang === 'en'
                ? "Offline Speech Model Not Cached (Whisper)"
                : "Modèle Vocal Hors-Ligne Non Mis en Cache (Whisper)";
        } else if (errMsg.includes("Ollama") || errMsg.includes("Local")) {
            errTitle = state.currentLang === 'en' ? "Local Model Error (Ollama)" : "Erreur Modèle Local (Ollama)";
        } else if (errMsg.includes("Gemini") || errMsg.includes("Remote")) {
            errTitle = state.currentLang === 'en' ? "Remote Model Error (Gemini)" : "Erreur Modèle Distant (Gemini)";
        } else if (errMsg.includes("transcript") || errMsg.includes("Captions")) {
            errTitle = state.currentLang === 'en' ? "Transcript Error" : "Erreur Transcription";
        }
        showError(errMsg, errTitle);
    }

    async function consumeNdjsonStream(response, effectiveModel) {
        const dict = translations[state.currentLang];
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedText = '';
        let resultRevealed = false;
        let rafPending = false;
        let streamMeta = null;
        let streamTranscriptInfo = null;

        const flushMarkdown = () => {
            rafPending = false;
            renderMarkdownIntoSummary(streamedText);
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
                const trimmed = rawLine.trim();
                if (!trimmed) continue;

                let event;
                try {
                    event = JSON.parse(trimmed);
                } catch (_) {
                    continue;
                }

                if (event.type === 'stage') {
                    if (event.stage === 'transcript') {
                        showLoading(dict.stageTranscript);
                    } else if (event.stage === 'frames') {
                        showLoading(dict.stageFrames);
                    } else if (event.stage === 'llm') {
                        showLoading(`${dict.stageLlm} (${effectiveModel})`);
                    }
                } else if (event.type === 'meta') {
                    streamMeta = event.metadata;
                    streamTranscriptInfo = event.transcript_info;
                    populateResultHeader(streamMeta, streamTranscriptInfo, effectiveModel);
                } else if (event.type === 'chunk') {
                    streamedText += event.delta || '';
                    if (!resultRevealed) {
                        resultRevealed = true;
                        hideLoading();
                        const resultCard = document.getElementById('result-container');
                        resultCard.classList.remove('hidden');
                        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    if (!rafPending) {
                        rafPending = true;
                        requestAnimationFrame(flushMarkdown);
                    }
                } else if (event.type === 'done') {
                    renderResults(event, { skipScroll: resultRevealed });
                    return;
                } else if (event.type === 'error') {
                    hideLoading();
                    classifyAndShowModelError(event.error || "Model streaming failed.");
                    return;
                }
            }
        }
    }

    async function handleSummarize() {
        const customContext = document.getElementById('custom-context').value.trim();
        const apiKey = document.getElementById('user-api-key').value.trim();

        if (state.summarizeAbortController) {
            state.summarizeAbortController.abort();
        }
        const abortController = new AbortController();
        state.summarizeAbortController = abortController;

        hideError();
        hideResult();

        const btnSubmit = document.getElementById('btn-submit');
        const btnContent = btnSubmit.querySelector('.btn-content');
        const btnLoader = btnSubmit.querySelector('.btn-loader');

        const effectiveModel = (state.selectedModel === 'gemma4')
            ? (state.selectedOllamaVariant || 'gemma4:latest')
            : state.selectedModel;
        const thinkingSelect = document.getElementById('argon-thinking-select');
        const thinkingLevel = thinkingSelect ? thinkingSelect.value : 'high';
        const songCheckbox = document.getElementById('song-mode-checkbox');
        const songMode = songCheckbox ? songCheckbox.checked : false;

        if (state.currentSourceMode === 'youtube') {
            const urlInput = document.getElementById('youtube-url');
            const url = urlInput.value.trim();
            if (!url) {
                urlInput.focus();
                showError(
                    state.currentLang === 'en'
                        ? "Please enter a YouTube video URL."
                        : "Veuillez entrer une adresse URL YouTube valide."
                );
                return;
            }
        } else if (!state.selectedFile) {
            const dropZone = document.getElementById('file-drop-zone');
            if (dropZone) dropZone.focus();
            showError(
                state.currentLang === 'en'
                    ? "Please select a video or audio file to upload."
                    : "Veuillez sélectionner un fichier vidéo ou audio à téléverser."
            );
            return;
        }

        btnSubmit.disabled = true;
        btnContent.classList.add('hidden');
        btnLoader.classList.remove('hidden');

        try {
            if (state.currentSourceMode === 'youtube') {
                const url = document.getElementById('youtube-url').value.trim();
                const loadingMsg = songMode
                    ? (state.currentLang === 'en'
                        ? `🎵 Song Mode: Running 2nd-pass audio lyrics extraction & analyzing with ${effectiveModel}...`
                        : `🎵 Mode Chanson : 2e passe d'extraction des paroles audio & analyse avec ${effectiveModel}...`)
                    : (state.currentLang === 'en'
                        ? `Extracting video transcript & analyzing with ${effectiveModel}...`
                        : `Extraction de la transcription & analyse avec ${effectiveModel}...`);
                showLoading(loadingMsg);

                const response = await fetch('/api/summarize/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url,
                        model: effectiveModel,
                        custom_context: customContext,
                        api_key: apiKey || null,
                        thinking_level: thinkingLevel,
                        lang: state.currentLang,
                        song_mode: songMode,
                    }),
                    signal: abortController.signal,
                });

                if (!response.ok || !response.body) {
                    const errData = await response.json().catch(() => ({}));
                    hideLoading();
                    const detail = errData.error || (typeof errData.detail === 'string' ? errData.detail : "Failed to summarize video.");
                    classifyAndShowModelError(detail);
                    return;
                }

                await consumeNdjsonStream(response, effectiveModel);
            } else {
                const loadingMsg = songMode
                    ? (state.currentLang === 'en'
                        ? `🎵 Song Mode: Running 2nd-pass lyrics transcription (faster-whisper) & analyzing with ${effectiveModel}...`
                        : `🎵 Mode Chanson : 2e passe de transcription des paroles (faster-whisper) & analyse avec ${effectiveModel}...`)
                    : (state.currentLang === 'en'
                        ? `Transcribing local media audio with faster-whisper & summarizing with ${effectiveModel}...`
                        : `Transcription audio locale (faster-whisper) & génération du résumé avec ${effectiveModel}...`);
                showLoading(loadingMsg);

                const formData = new FormData();
                formData.append('file', state.selectedFile);
                formData.append('model', effectiveModel);
                formData.append('custom_context', customContext);
                formData.append('thinking_level', thinkingLevel);
                formData.append('lang', state.currentLang);
                formData.append('song_mode', songMode ? 'true' : 'false');
                if (apiKey) formData.append('api_key', apiKey);

                const response = await fetch('/api/summarize-upload/stream', {
                    method: 'POST',
                    body: formData,
                    signal: abortController.signal,
                });

                if (!response.ok || !response.body) {
                    const errData = await response.json().catch(() => ({}));
                    hideLoading();
                    const detail = errData.error || (typeof errData.detail === 'string' ? errData.detail : "Failed to process uploaded file.");
                    classifyAndShowModelError(detail);
                    return;
                }

                await consumeNdjsonStream(response, effectiveModel);
            }
        } catch (err) {
            hideLoading();
            if (err && err.name === 'AbortError') {
                return;
            }
            const connErr = state.currentLang === 'en'
                ? `Network or Communication Failure: ${err.message}`
                : `Échec de connexion ou réseau : ${err.message}`;
            showError(connErr, state.currentLang === 'en' ? "Connection Failure" : "Échec de Connexion");
        } finally {
            if (state.summarizeAbortController === abortController) {
                state.summarizeAbortController = null;
            }
            btnSubmit.disabled = false;
            btnContent.classList.remove('hidden');
            btnLoader.classList.add('hidden');
        }
    }

    function cancelSummarize() {
        if (state.summarizeAbortController) {
            state.summarizeAbortController.abort();
            state.summarizeAbortController = null;
        }
        hideLoading();
    }

    function renderResults(data, { skipScroll = false } = {}) {
        hideLoading();

        state.currentSummaryMarkdown = data.summary || '';
        state.currentVideoData = data;

        populateResultHeader(data.metadata, data.transcript_info, data.model_used || 'Ollama Gemma 4');
        renderMarkdownIntoSummary(state.currentSummaryMarkdown);

        const drawer = document.getElementById('transcript-drawer');
        if (drawer) {
            drawer.open = false;
            syncTranscriptToggleText();
        }

        const resultCard = document.getElementById('result-container');
        resultCard.classList.remove('hidden');
        if (!skipScroll) {
            resultCard.scrollIntoView({ behavior: 'smooth' });
        }
    }

    function showLoading(msg) {
        const dict = translations[state.currentLang];
        document.getElementById('loading-status').textContent = msg || dict.loadingTitle;
        document.getElementById('loading-container').classList.remove('hidden');
    }

    function hideLoading() {
        document.getElementById('loading-container').classList.add('hidden');
    }

    function showError(msg, title) {
        hideLoading();
        hideResult();
        const dict = translations[state.currentLang];

        const titleEl = document.getElementById('error-title');
        const msgEl = document.getElementById('error-message');
        const containerEl = document.getElementById('error-container');

        if (titleEl) titleEl.textContent = title || dict.errorTitleDefault;
        if (msgEl) msgEl.textContent = msg || "An unknown error occurred.";

        if (containerEl) {
            containerEl.classList.remove('hidden');
            containerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function hideError() {
        document.getElementById('error-container').classList.add('hidden');
    }

    function hideResult() {
        document.getElementById('result-container').classList.add('hidden');
        document.getElementById('summary-content').textContent = '';
    }

    function copySummary() {
        if (!state.currentSummaryMarkdown) return;
        const dict = translations[state.currentLang];

        navigator.clipboard.writeText(state.currentSummaryMarkdown).then(() => {
            const copyBtnText = document.getElementById('copy-text');
            copyBtnText.textContent = dict.btnCopied;
            setTimeout(() => {
                copyBtnText.textContent = dict.btnCopy;
            }, 2000);
        }).catch(() => {
            showError(state.currentLang === 'en' ? "Failed to copy summary." : "Échec de la copie.");
        });
    }

    function downloadMarkdown() {
        if (!state.currentSummaryMarkdown) return;

        const title = state.currentVideoData && state.currentVideoData.metadata
            ? state.currentVideoData.metadata.title
            : 'summary';
        const cleanTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${cleanTitle}_devfest_summary.md`;

        const blob = new Blob([state.currentSummaryMarkdown], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function toggleTranscript() {
        const drawer = document.getElementById('transcript-drawer');
        if (!drawer) return;
        drawer.open = !drawer.open;
        syncTranscriptToggleText();
        if (drawer.open) {
            drawer.scrollIntoView({ behavior: 'smooth' });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        let savedLang = 'bi';
        try {
            savedLang = localStorage.getItem('devfest_lang') || 'bi';
        } catch (_) {
            savedLang = 'bi';
        }
        setLanguage(savedLang);
        loadOllamaModels();

        // Language switcher buttons
        document.querySelectorAll('.lang-btn[data-lang]').forEach(btn => {
            btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
        });

        // Source mode tabs + keyboard roving tabindex fallback when `focusgroup` is absent
        const tablist = document.getElementById('source-tablist');
        const tabButtons = Array.from(document.querySelectorAll('.tab-btn[data-source-mode]'));
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => switchSourceMode(btn.dataset.sourceMode));
        });

        if (tablist && !Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
            tablist.addEventListener('keydown', (e) => {
                const idx = tabButtons.indexOf(document.activeElement);
                if (idx === -1) return;
                let nextIdx = -1;
                if (e.key === 'ArrowRight') {
                    nextIdx = (idx + 1) % tabButtons.length;
                } else if (e.key === 'ArrowLeft') {
                    nextIdx = (idx - 1 + tabButtons.length) % tabButtons.length;
                } else if (e.key === 'Home') {
                    nextIdx = 0;
                } else if (e.key === 'End') {
                    nextIdx = tabButtons.length - 1;
                }
                if (nextIdx !== -1) {
                    e.preventDefault();
                    switchSourceMode(tabButtons[nextIdx].dataset.sourceMode, { focusTab: true });
                }
            });
        }

        // Form submission
        const form = document.getElementById('summarize-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                handleSummarize();
            });
        }

        // YouTube URL input & paste button
        const urlInput = document.getElementById('youtube-url');
        if (urlInput) {
            urlInput.addEventListener('input', (e) => {
                hideError();
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => {
                    fetchVideoPreview(e.target.value);
                }, 400);
            });

            urlInput.addEventListener('paste', () => {
                setTimeout(() => {
                    fetchVideoPreview(urlInput.value);
                }, 80);
            });
        }

        const pasteBtn = document.getElementById('btn-paste');
        if (pasteBtn) {
            pasteBtn.addEventListener('click', pasteFromClipboard);
        }

        // Local file upload drop-zone (pointer, keyboard Enter/Space, and drag & drop)
        const dropZone = document.getElementById('file-drop-zone');
        const fileInput = document.getElementById('video-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', () => handleFileSelected(fileInput.files));
        }

        if (dropZone && fileInput) {
            dropZone.addEventListener('click', (e) => {
                if (e.target !== fileInput) {
                    fileInput.click();
                }
            });
            dropZone.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    fileInput.click();
                } else if (e.key === ' ') {
                    e.preventDefault();
                }
            });
            dropZone.addEventListener('keyup', (e) => {
                if (e.key === ' ') {
                    fileInput.click();
                }
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.add('dragover');
                });
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('dragover');
                });
            });

            dropZone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt && dt.files && dt.files.length > 0) {
                    handleFileSelected(dt.files);
                }
            });
        }

        // Song Mode checkbox active visual sync
        const songCheckbox = document.getElementById('song-mode-checkbox');
        const songCard = document.getElementById('song-mode-card');
        if (songCheckbox && songCard) {
            songCheckbox.addEventListener('change', () => {
                songCard.classList.toggle('active', songCheckbox.checked);
            });
        }

        // AI Model selection cards & native radio group
        document.querySelectorAll('.model-card').forEach(card => {
            card.addEventListener('click', () => {
                const radio = card.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    selectModel(radio.value);
                }
            });
        });

        document.querySelectorAll('input[name="model"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    selectModel(radio.value);
                }
            });
        });

        // Ollama variant select & manual refresh
        const ollamaSelect = document.getElementById('ollama-model-select');
        if (ollamaSelect) {
            ollamaSelect.addEventListener('change', () => {
                state.selectedOllamaVariant = ollamaSelect.value;
                updateOllamaModelNote(ollamaSelect.value);
            });
        }

        const refreshBtn = document.getElementById('btn-refresh-models');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => loadOllamaModels(true));
        }

        // Action & Cancel buttons
        const cancelBtn = document.getElementById('btn-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', cancelSummarize);

        const closeErrBtn = document.getElementById('btn-close-error');
        if (closeErrBtn) closeErrBtn.addEventListener('click', hideError);

        const copyBtn = document.getElementById('btn-copy');
        if (copyBtn) copyBtn.addEventListener('click', copySummary);

        const downloadBtn = document.getElementById('btn-download');
        if (downloadBtn) downloadBtn.addEventListener('click', downloadMarkdown);

        const toggleTranscriptBtn = document.getElementById('btn-toggle-transcript');
        if (toggleTranscriptBtn) toggleTranscriptBtn.addEventListener('click', toggleTranscript);

        const transcriptDrawer = document.getElementById('transcript-drawer');
        if (transcriptDrawer) {
            transcriptDrawer.addEventListener('toggle', syncTranscriptToggleText);
        }
    });
})();
