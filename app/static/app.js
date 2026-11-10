/**
 * Video Summarizer - DevFest Sherbrooke & Eastern Townships Frontend Controller
 * Full Bilingual Interface (FR / EN / BILINGUE)
 */

let selectedModel = 'gemma4';
let selectedOllamaVariant = 'gemma4:latest';
let availableOllamaModels = [];
let currentSourceMode = 'youtube'; // 'youtube' or 'file'
let selectedFile = null;
let currentVideoObjectUrl = null;
let currentSummaryMarkdown = '';
let currentVideoData = null;
let debounceTimer = null;
let currentLang = 'bi'; // 'fr', 'en', 'bi' (default bilingual)

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Comprehensive Bilingual Dictionary
const translations = {
    fr: {
        langLabel: "Langue :",
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
        labelLocalVariant: "Variante locale Gemma 4 :",
        btnRefreshModels: "Actualiser",
        noteLocalServer: "Découvert depuis le serveur Ollama local.",
        labelArgonThinking: "Niveau de réflexion Argon (API Interactions) :",
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
        loadingTitle: "Extraction de la transcription et génération du sommaire...",
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
        langLabel: "Language:",
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
        labelLocalVariant: "Select Local Gemma 4 Variant:",
        btnRefreshModels: "Refresh",
        noteLocalServer: "Loaded from local Ollama server.",
        labelArgonThinking: "Argon Reasoning Depth (Interactions API):",
        optThinkingHigh: "High (Deep Reasoning • Recommended)",
        optThinkingMedium: "Medium (Balanced)",
        optThinkingLow: "Low (Fast)",
        noteArgonThinking: "Controls reasoning depth via the Google Interactions API.",
        labelContext: "Extra Context & Expectations",
        tagOptional: "(Optional)",
        contextPlaceholder: "E.g. Focus on code examples, list top 5 takeaways for developers, or summarize for beginners...",
        toggleKeyText: "Custom Gemini API Key (optional)",
        apiKeyPlaceholder: "AIzaSy... (Leave blank to use the server key)",
        helpApiKey: "Optional. Your key will never be stored on the server.",
        btnSubmit: "Generate Summary",
        btnAnalyzing: "Analyzing...",
        loadingTitle: "Extracting transcript and generating summary...",
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
        langLabel: "Langue / Language:",
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
        labelLocalVariant: "Variante locale Gemma 4 / Local Variant:",
        btnRefreshModels: "Actualiser / Refresh",
        noteLocalServer: "Découvert depuis le serveur Ollama local / Loaded from local Ollama.",
        labelArgonThinking: "Niveau de réflexion Argon / Thinking Level:",
        optThinkingHigh: "Élevé / High (Raisonnement approfondi • Recommandé / Recommended)",
        optThinkingMedium: "Moyen / Medium (Équilibré / Balanced)",
        optThinkingLow: "Faible / Low (Rapide / Fast)",
        noteArgonThinking: "Contrôle la profondeur de raisonnement via l'API Interactions de Google / Controls reasoning depth via Google Interactions API.",
        labelContext: "Contexte additionnel et attentes / Extra Context &amp; Expectations",
        tagOptional: "(Optionnel / Optional)",
        contextPlaceholder: "Ex. : Mettre l'accent sur le code, 5 points clés... / E.g. Focus on code, 5 takeaways...",
        toggleKeyText: "Clé API Gemini personnalisée (optionnelle) / Custom Gemini API Key",
        apiKeyPlaceholder: "AIzaSy... (Laisser vide pour la clé serveur / Leave blank for server key)",
        helpApiKey: "Optionnel. Votre clé ne sera jamais enregistrée / Never stored on server.",
        btnSubmit: "Générer le sommaire / Generate Summary",
        btnAnalyzing: "Analyse en cours / Analyzing...",
        loadingTitle: "Extraction de la transcription et génération du sommaire / Generating summary...",
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

document.addEventListener('DOMContentLoaded', () => {
    // Restore preferred language or default to bilingual
    const savedLang = localStorage.getItem('devfest_lang') || 'bi';
    setLanguage(savedLang);

    // Initial fetch of local Ollama models
    loadOllamaModels();

    const urlInput = document.getElementById('youtube-url');
    
    // Auto-detect YouTube URL changes for live preview
    if (urlInput) {
        urlInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetchVideoPreview(e.target.value);
            }, 400);
        });

        urlInput.addEventListener('paste', () => {
            setTimeout(() => {
                fetchVideoPreview(urlInput.value);
            }, 100);
        });
    }

    // Drag and drop for MP4 file upload
    const dropZone = document.getElementById('file-drop-zone');
    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('dragover');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                handleFileSelected(files);
            }
        });
    }
});

function formatOllamaOptionLabel(m) {
    let labelText = m.name;
    if (m.parameter_size) {
        const isPowerful = m.name.includes('12b') || m.name.includes('26b') || m.name.includes('27b');
        const isFast = m.name.includes('latest') || m.name.includes('8b');
        if (isPowerful) {
            const desc = currentLang === 'en' ? 'More Powerful' : (currentLang === 'fr' ? 'Plus puissant' : 'Plus puissant / More Powerful');
            labelText += ` (${m.parameter_size} - ${desc})`;
        } else if (isFast) {
            const desc = currentLang === 'en' ? 'Fast & Balanced' : (currentLang === 'fr' ? 'Rapide & équilibré' : 'Rapide & équilibré / Fast & Balanced');
            labelText += ` (${m.parameter_size} - ${desc})`;
        } else {
            labelText += ` (${m.parameter_size})`;
        }
    }
    return labelText;
}

function renderOllamaSelectOptions() {
    const selectEl = document.getElementById('ollama-model-select');
    if (!selectEl || availableOllamaModels.length === 0) return;

    const currentVal = selectedOllamaVariant || selectEl.value;
    selectEl.innerHTML = '';
    let preferredFound = false;

    availableOllamaModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = formatOllamaOptionLabel(m);
        if (m.name === currentVal || (!currentVal && m.name === 'gemma4:latest')) {
            opt.selected = true;
            selectedOllamaVariant = m.name;
            preferredFound = true;
        }
        selectEl.appendChild(opt);
    });

    if (!preferredFound && availableOllamaModels.length > 0) {
        selectEl.selectedIndex = 0;
        selectedOllamaVariant = availableOllamaModels[0].name;
    }
}

function setLanguage(lang) {
    if (!translations[lang]) lang = 'bi';
    currentLang = lang;
    localStorage.setItem('devfest_lang', lang);

    // Update active pill
    ['fr', 'bi', 'en'].forEach(l => {
        const btn = document.getElementById(`lang-${l}`);
        if (btn) {
            btn.classList.toggle('active', l === lang);
        }
    });

    const dict = translations[lang];

    // Apply translations to data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.innerHTML = dict[key];
        }
    });

    // Update input placeholders
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

    // Re-localize dynamic Ollama model labels & note
    renderOllamaSelectOptions();
    updateOllamaModelNote(selectedOllamaVariant);
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
                availableOllamaModels = data.models;
                renderOllamaSelectOptions();
                updateOllamaModelNote(selectedOllamaVariant);
                return;
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

function onOllamaVariantChange(val) {
    selectedOllamaVariant = val;
    updateOllamaModelNote(val);
}

function updateOllamaModelNote(modelName) {
    const noteEl = document.getElementById('ollama-model-note');
    if (!noteEl) return;

    const found = availableOllamaModels.find(m => m.name === modelName);
    const isEn = currentLang === 'en';
    const isFr = currentLang === 'fr';
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

function switchSourceMode(mode) {
    currentSourceMode = mode;
    
    const tabYt = document.getElementById('tab-yt');
    const tabFile = document.getElementById('tab-file');
    const ytContainer = document.getElementById('yt-input-container');
    const fileContainer = document.getElementById('file-input-container');
    const previewCard = document.getElementById('video-preview-card');

    if (mode === 'youtube') {
        tabYt.classList.add('active');
        tabFile.classList.remove('active');
        ytContainer.classList.remove('hidden');
        fileContainer.classList.add('hidden');
        if (document.getElementById('youtube-url').value.trim()) {
            previewCard.classList.remove('hidden');
        }
    } else {
        tabFile.classList.add('active');
        tabYt.classList.remove('active');
        fileContainer.classList.remove('hidden');
        ytContainer.classList.add('hidden');
        previewCard.classList.add('hidden');
    }
}

function handleFileSelected(files) {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const isMedia = file.type.startsWith('video/') ||
        file.type.startsWith('audio/') ||
        file.name.match(/\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|flac|ogg|aac)$/i);
    if (!isMedia) {
        alert(currentLang === 'en' ? "Please select a valid video or audio file (.mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a)." : "Veuillez sélectionner un fichier vidéo ou audio valide (.mp4, .mov, .mkv, .webm, .mp3, .wav, .m4a).");
        return;
    }

    selectedFile = file;

    // Auto-enable Song Mode if a pure audio file (.mp3, .wav, .m4a, .flac, .ogg) is selected
    if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|flac|ogg|aac)$/i)) {
        const songCheckbox = document.getElementById('song-mode-checkbox');
        const songCard = document.getElementById('song-mode-card');
        if (songCheckbox && !songCheckbox.checked) {
            songCheckbox.checked = true;
            if (songCard) songCard.classList.add('active');
        }
    }

    // Display local file info
    document.getElementById('local-filename').textContent = file.name;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    document.getElementById('local-filesize').innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${escapeHtml(sizeMb)} MB`;

    // Set local video player src & release previous Blob URL to prevent memory leaks
    const localVideo = document.getElementById('local-video-player');
    if (localVideo) {
        if (currentVideoObjectUrl) {
            URL.revokeObjectURL(currentVideoObjectUrl);
        }
        currentVideoObjectUrl = URL.createObjectURL(file);
        localVideo.src = currentVideoObjectUrl;
        localVideo.load();
        localVideo.play().catch(() => {
            // Autoplay blocked by browser policy; user can click play manually
        });
    }

    document.getElementById('local-file-card').classList.remove('hidden');
}

function selectModel(modelKey) {
    selectedModel = modelKey;
    
    document.querySelectorAll('.model-card').forEach(card => card.classList.remove('active'));
    
    const activeCard = document.getElementById(`card-${modelKey}`);
    if (activeCard) {
        activeCard.classList.add('active');
        const radio = activeCard.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
    }

    // Toggle Ollama model variant selector box
    const ollamaVariantBox = document.getElementById('ollama-variant-container');
    if (ollamaVariantBox) {
        if (modelKey === 'gemma4') {
            ollamaVariantBox.classList.remove('hidden');
        } else {
            ollamaVariantBox.classList.add('hidden');
        }
    }

    // Toggle Argon thinking level selector box
    const argonThinkingBox = document.getElementById('argon-thinking-container');
    if (argonThinkingBox) {
        if (modelKey === 'argon') {
            argonThinkingBox.classList.remove('hidden');
        } else {
            argonThinkingBox.classList.add('hidden');
        }
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            const urlInput = document.getElementById('youtube-url');
            urlInput.value = text.trim();
            fetchVideoPreview(urlInput.value);
        }
    } catch (err) {
        alert(currentLang === 'en' ? "Please paste using Ctrl+V / Cmd+V." : "Veuillez coller avec Ctrl+V / Cmd+V.");
    }
}

function toggleApiKeyInput() {
    const drawer = document.getElementById('api-key-drawer');
    const chevron = document.getElementById('key-chevron');
    
    drawer.classList.toggle('hidden');
    chevron.classList.toggle('open');
}

async function fetchVideoPreview(url) {
    if (currentSourceMode !== 'youtube') return;
    
    const previewCard = document.getElementById('video-preview-card');
    const embedIframe = document.getElementById('yt-embed-player');
    
    if (!url || !url.trim()) {
        previewCard.classList.add('hidden');
        if (embedIframe) embedIframe.src = "";
        return;
    }

    try {
        const res = await fetch('/api/video-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.trim() })
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.metadata && data.video_id) {
                document.getElementById('preview-title').textContent = data.metadata.title;
                document.getElementById('preview-author').innerHTML = `<i class="fa-solid fa-user-circle"></i> ${escapeHtml(data.metadata.author_name)}`;
                
                const previewThumb = document.getElementById('preview-thumb');
                if (previewThumb) {
                    const fallback = `https://i.ytimg.com/vi/${encodeURIComponent(data.video_id)}/hqdefault.jpg`;
                    previewThumb.src = data.metadata.thumbnail_url || fallback;
                    previewThumb.onerror = function() {
                        if (previewThumb.src !== fallback) {
                            previewThumb.src = fallback;
                        } else {
                            previewThumb.src = '/static/video-placeholder.png';
                        }
                    };
                }

                const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(data.video_id)}?autoplay=1&enablejsapi=1&rel=0`;
                if (embedIframe && embedIframe.src !== embedUrl) {
                    embedIframe.src = embedUrl;
                }

                previewCard.classList.remove('hidden');
                return;
            }
        }
    } catch (err) {
        console.warn("Preview fetch error:", err);
    }
    previewCard.classList.add('hidden');
    if (embedIframe) embedIframe.src = "";
}

async function handleSummarize() {
    const customContext = document.getElementById('custom-context').value.trim();
    const apiKey = document.getElementById('user-api-key').value.trim();
    const dict = translations[currentLang];
    
    hideError();
    hideResult();

    const btnSubmit = document.getElementById('btn-submit');
    const btnContent = btnSubmit.querySelector('.btn-content');
    const btnLoader = btnSubmit.querySelector('.btn-loader');
    
    btnSubmit.disabled = true;
    btnContent.classList.add('hidden');
    btnLoader.classList.remove('hidden');

    const effectiveModel = (selectedModel === 'gemma4') ? (selectedOllamaVariant || 'gemma4:latest') : selectedModel;
    const thinkingSelect = document.getElementById('argon-thinking-select');
    const thinkingLevel = thinkingSelect ? thinkingSelect.value : 'high';
    const songCheckbox = document.getElementById('song-mode-checkbox');
    const songMode = songCheckbox ? songCheckbox.checked : false;

    try {
        let response, data;

        if (currentSourceMode === 'youtube') {
            const url = document.getElementById('youtube-url').value.trim();
            if (!url) {
                const msg = currentLang === 'en' ? "Please enter a YouTube video URL." : "Veuillez entrer une adresse URL YouTube valide.";
                showError(msg);
                return;
            }

            const loadingMsg = songMode ? (
                currentLang === 'en' ?
                    `🎵 Song Mode: Running 2nd-pass audio lyrics extraction & analyzing with ${effectiveModel}...` :
                    `🎵 Mode Chanson : 2e passe d'extraction des paroles audio & analyse avec ${effectiveModel}...`
            ) : (
                currentLang === 'en' ? 
                    `Extracting video transcript & analyzing with ${effectiveModel}...` : 
                    `Extraction de la transcription & analyse avec ${effectiveModel}...`
            );
            showLoading(loadingMsg);

            response = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    model: effectiveModel,
                    custom_context: customContext,
                    api_key: apiKey || null,
                    thinking_level: thinkingLevel,
                    lang: currentLang,
                    song_mode: songMode
                })
            });

            data = await response.json();

        } else {
            // Local Media Upload mode
            if (!selectedFile) {
                const msg = currentLang === 'en' ? "Please select a video or audio file to upload." : "Veuillez sélectionner un fichier vidéo ou audio à téléverser.";
                showError(msg);
                return;
            }

            const loadingMsg = songMode ? (
                currentLang === 'en' ?
                    `🎵 Song Mode: Running 2nd-pass lyrics transcription (faster-whisper) & analyzing with ${effectiveModel}...` :
                    `🎵 Mode Chanson : 2e passe de transcription des paroles (faster-whisper) & analyse avec ${effectiveModel}...`
            ) : (
                currentLang === 'en' ? 
                    `Transcribing local media audio with faster-whisper & summarizing with ${effectiveModel}...` : 
                    `Transcription audio locale (faster-whisper) & génération du résumé avec ${effectiveModel}...`
            );
            showLoading(loadingMsg);

            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('model', effectiveModel);
            formData.append('custom_context', customContext);
            formData.append('thinking_level', thinkingLevel);
            formData.append('lang', currentLang);
            formData.append('song_mode', songMode ? 'true' : 'false');
            if (apiKey) formData.append('api_key', apiKey);

            response = await fetch('/api/summarize-upload', {
                method: 'POST',
                body: formData
            });

            data = await response.json();
        }

        if (!response.ok || !data.success) {
            hideLoading();
            const errMsg = data.error || (data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : "An unexpected error occurred while communicating with the model.");
            let errTitle = dict.errorTitleDefault;
            if (errMsg.includes("Ollama") || errMsg.includes("Local")) {
                errTitle = currentLang === 'en' ? "Local Model Error (Ollama)" : "Erreur Modèle Local (Ollama)";
            } else if (errMsg.includes("Gemini") || errMsg.includes("Remote")) {
                errTitle = currentLang === 'en' ? "Remote Model Error (Gemini)" : "Erreur Modèle Distant (Gemini)";
            } else if (errMsg.includes("transcript") || errMsg.includes("Captions")) {
                errTitle = currentLang === 'en' ? "Transcript Error" : "Erreur Transcription";
            }
            showError(errMsg, errTitle);
            return;
        }

        renderResults(data);

    } catch (err) {
        hideLoading();
        const connErr = currentLang === 'en' ? `Network or Communication Failure: ${err.message}` : `Échec de connexion ou réseau : ${err.message}`;
        showError(connErr, currentLang === 'en' ? "Connection Failure" : "Échec de Connexion");
    } finally {
        btnSubmit.disabled = false;
        btnContent.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }
}

function renderResults(data) {
    hideLoading();
    
    currentSummaryMarkdown = data.summary;
    currentVideoData = data;
    const dict = translations[currentLang];

    // Set Meta info
    const modelBadge = document.getElementById('res-model-used');
    modelBadge.textContent = data.model_used || 'Ollama Gemma 4';
    
    const langInfo = document.getElementById('res-lang-info');
    const langName = escapeHtml(data.transcript_info.language || (currentLang === 'en' ? 'English' : 'Français'));
    const segCount = Number(data.transcript_info.segment_count) || 0;
    langInfo.innerHTML = `<i class="fa-solid fa-closed-captioning"></i> ${langName} (${segCount} ${escapeHtml(dict.transcriptLines)})`;

    // Video details
    const resThumb = document.getElementById('res-thumb');
    const meta = data.metadata || {};
    const videoId = meta.video_id || '';
    const fallback = videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : '/static/video-placeholder.png';
    const primaryThumb = meta.thumbnail_url || fallback;

    if (resThumb) {
        resThumb.src = primaryThumb;
        resThumb.onerror = function() {
            if (resThumb.src !== fallback) {
                resThumb.src = fallback;
            } else {
                resThumb.src = '/static/video-placeholder.png';
            }
        };
    }
    document.getElementById('res-title').textContent = meta.title || 'Video Summary';
    document.getElementById('res-author').textContent = meta.author_name || '';

    // Render Markdown safely with DOMPurify sanitization
    const summaryBox = document.getElementById('summary-content');
    if (window.marked) {
        const rawHtml = marked.parse(data.summary);
        summaryBox.innerHTML = window.DOMPurify ? DOMPurify.sanitize(rawHtml) : rawHtml;
    } else {
        summaryBox.textContent = data.summary;
    }

    // Set Transcript text
    if (data.transcript_info && data.transcript_info.full_transcript) {
        document.getElementById('transcript-text-content').textContent = data.transcript_info.full_transcript;
    } else {
        document.getElementById('transcript-text-content').textContent = currentLang === 'en' ? "Transcript details unavailable." : "Détails de la transcription indisponibles.";
    }

    // Show result card
    const resultCard = document.getElementById('result-container');
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth' });
}

function showLoading(msg) {
    const dict = translations[currentLang];
    document.getElementById('loading-status').textContent = msg || dict.loadingTitle;
    document.getElementById('loading-container').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-container').classList.add('hidden');
}

function showError(msg, title) {
    hideLoading();
    hideResult();
    const dict = translations[currentLang];

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
}

function copySummary() {
    if (!currentSummaryMarkdown) return;
    const dict = translations[currentLang];
    
    navigator.clipboard.writeText(currentSummaryMarkdown).then(() => {
        const copyBtnText = document.getElementById('copy-text');
        copyBtnText.textContent = dict.btnCopied;
        setTimeout(() => {
            copyBtnText.textContent = dict.btnCopy;
        }, 2000);
    }).catch(() => {
        alert(currentLang === 'en' ? "Failed to copy summary." : "Échec de la copie.");
    });
}

function downloadMarkdown() {
    if (!currentSummaryMarkdown) return;
    
    const title = currentVideoData && currentVideoData.metadata ? currentVideoData.metadata.title : 'summary';
    const cleanTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${cleanTitle}_devfest_summary.md`;
    
    const blob = new Blob([currentSummaryMarkdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toggleTranscript() {
    const drawer = document.getElementById('transcript-drawer');
    const toggleText = document.getElementById('transcript-toggle-text');
    const dict = translations[currentLang];
    
    drawer.classList.toggle('hidden');
    if (drawer.classList.contains('hidden')) {
        toggleText.textContent = dict.btnViewTranscript;
    } else {
        toggleText.textContent = dict.btnHideTranscript;
        drawer.scrollIntoView({ behavior: 'smooth' });
    }
}
