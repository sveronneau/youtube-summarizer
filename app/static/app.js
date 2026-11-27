/**
 * Video Summarizer - GDG Ottawa (Learn, Build & Jingle) Frontend Controller
 * Full Bilingual Interface (FR / EN / BILINGUE) with Live NDJSON Streaming & Accessibility
 */

(() => {
    const supportsHasSelector = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:has(*))');

    const state = {
        selectedModel: 'gemma4',
        selectedOllamaVariant: '',
        availableOllamaModels: [],
        ollamaLoadedFetched: false,
        ollamaOffline: false,
        selectedLemonadeVariant: '',
        availableLemonadeModels: [],
        lemonadeLoadedFetched: false,
        lemonadeOffline: false,
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
            pageTitle: "Sommaire Vidéo IA | GDG Ottawa — Learn, Build & Jingle",
            langLabel: "Langue :",
            tablistLabel: "Mode de source média",
            titlePrefix: "Sommaire Vidéo",
            subtitle: "Codelab Google festif et célébration des Fêtes • Propulsé par GDG Ottawa",
            eventMeta: "🎄 Atelier virtuel • 15 déc. 2026 • 17 h à 19 h HNE • Apportez votre boisson chaude ☕",
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
            tagLocalServer: "Modèle local",
            descGemma4: "Modèle local privé via Ollama.",
            tagLemonade: "Modèle local",
            descLemonade: "Modèle local privé via Lemonade Server.",
            tagHydrogen: "Rapide • 1M",
            descHydrogen: "Vitesse élevée et raisonnement efficace (1M contexte).",
            tagNeon: "Équilibré • 1M",
            descNeon: "Intelligence quasi-pointe et rapidité élevée (1M contexte).",
            tagArgon: "Raisonnement • 1M",
            descArgon: "Raisonnement approfondi et analyse multimodale.",
            tagCarbon: "Pointe • 1M",
            descCarbon: "Raisonnement de pointe maximal (1M contexte).",
            labelLocalVariant: "Modèle chargé Ollama :",
            optOllamaEmpty: "Aucun modèle actuellement chargé dans Ollama",
            optOllamaOffline: "Serveur Ollama hors ligne (http://127.0.0.1:11434)",
            btnRefreshModels: "Actualiser",
            noteLocalServer: "Vérification des modèles chargés dans Ollama (/api/ps)...",
            noteOllamaEmpty: "Aucun modèle chargé en mémoire. Chargez un modèle dans Ollama (ex. `ollama run <modèle>`) puis cliquez sur Actualiser.",
            labelLemonadeVariant: "Modèle chargé Lemonade :",
            optLemonadeEmpty: "Aucun modèle actuellement chargé dans Lemonade",
            optLemonadeOffline: "Lemonade Server hors ligne (http://127.0.0.1:13305)",
            noteLemonadeServer: "Vérification des modèles chargés dans Lemonade (/api/v1/health)...",
            noteLemonadeEmpty: "Aucun modèle chargé en mémoire. Chargez un modèle dans Lemonade Server puis cliquez sur Actualiser.",
            labelCarbonThinking: "Niveau de réflexion Gemini 4 Carbon (API Interactions) :",
            noteCarbonThinking: "Gemini 4 Carbon utilise le niveau Moyen par défaut. Vous pouvez ajuster le niveau de réflexion (Faible, Moyen, Élevé) via thinking_level dans l'API Interactions.",
            labelArgonThinking: "Niveau de réflexion Gemini 4 Argon (API Interactions) :",
            labelNeonThinking: "Niveau de réflexion Gemini 4 Neon (API Interactions) :",
            noteNeonThinking: "Gemini 4 Neon prend en charge quatre niveaux de réflexion (Faible, Moyen, Élevé, Très élevé xhigh) via thinking_level dans l'API Interactions.",
            labelHydrogenThinking: "Niveau de réflexion Gemini 4 Hydrogen (API Interactions) :",
            noteHydrogenThinking: "Gemini 4 Hydrogen prend en charge quatre niveaux de réflexion (Faible, Moyen, Élevé, Très élevé xhigh) via thinking_level dans l'API Interactions.",
            optThinkingXHigh: "Très élevé (xhigh • Profondeur maximale Hydrogen / Neon)",
            optThinkingHigh: "Élevé (Raisonnement approfondi)",
            optThinkingMedium: "Moyen (Équilibré • Recommandé)",
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
            loadingSub: "Traitement en cours avec la magie des Fêtes de GDG Ottawa ☕🎄",
            errorTitleDefault: "Impossible de générer le sommaire",
            btnCopy: "Copier le résumé",
            btnCopied: "Copié !",
            btnDownload: "Télécharger .md",
            btnViewTranscript: "Voir la transcription",
            btnHideTranscript: "Masquer la transcription",
            titleTranscript: "Transcription complète",
            footerText: "Conçu pour <strong>GDG Ottawa — Learn, Build &amp; Jingle</strong> 🎄✨ • Atelier virtuel des Fêtes (15 déc. 2026) • Propulsé par <strong>Tokens &amp; Chocolat Chaud</strong>",
            transcriptLines: "lignes",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        },
        en: {
            pageTitle: "AI Video Summarizer | GDG Ottawa — Learn, Build & Jingle",
            langLabel: "Language:",
            tablistLabel: "Media source mode",
            titlePrefix: "AI Video Summarizer",
            subtitle: "Festive Google Codelab & Holiday Celebration • Powered by GDG Ottawa",
            eventMeta: "🎄 Virtual Workshop • Dec 15, 2026 • 5:00–7:00 PM EST • Bring your cozy beverage ☕",
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
            tagLocalServer: "Local Model",
            descGemma4: "Private local model via Ollama.",
            tagLemonade: "Local Model",
            descLemonade: "Private local model via Lemonade Server.",
            tagHydrogen: "Fast • 1M",
            descHydrogen: "High-speed, cost-efficient reasoning (1M context).",
            tagNeon: "Balanced • 1M",
            descNeon: "Near-flagship intelligence with high-efficiency speed (1M context).",
            tagArgon: "Reasoning • 1M",
            descArgon: "Deep reasoning and multimodal analysis.",
            tagCarbon: "Frontier • 1M",
            descCarbon: "Maximum frontier reasoning depth (1M context).",
            labelLocalVariant: "Loaded Ollama Model:",
            optOllamaEmpty: "No models currently loaded in Ollama",
            optOllamaOffline: "Ollama server offline (http://127.0.0.1:11434)",
            btnRefreshModels: "Refresh",
            noteLocalServer: "Checking loaded models in Ollama (/api/ps)...",
            noteOllamaEmpty: "No models loaded in memory. Load a model in Ollama (e.g. `ollama run <model>`), then click Refresh.",
            labelLemonadeVariant: "Loaded Lemonade Model:",
            optLemonadeEmpty: "No models currently loaded in Lemonade",
            optLemonadeOffline: "Lemonade Server offline (http://127.0.0.1:13305)",
            noteLemonadeServer: "Checking loaded models in Lemonade (/api/v1/health)...",
            noteLemonadeEmpty: "No models loaded in memory. Load a model in Lemonade Server, then click Refresh.",
            labelCarbonThinking: "Gemini 4 Carbon Reasoning Depth (Interactions API):",
            noteCarbonThinking: "Gemini 4 Carbon uses Medium reasoning by default. You can adjust the reasoning depth (Low, Medium, High) via thinking_level in the Google Interactions API.",
            labelArgonThinking: "Gemini 4 Argon Reasoning Depth (Interactions API):",
            labelNeonThinking: "Gemini 4 Neon Reasoning Depth (Interactions API):",
            noteNeonThinking: "Gemini 4 Neon supports four reasoning levels (Low, Medium, High, Extra High xhigh) via thinking_level in the Google Interactions API.",
            labelHydrogenThinking: "Gemini 4 Hydrogen Reasoning Depth (Interactions API):",
            noteHydrogenThinking: "Gemini 4 Hydrogen supports four reasoning levels (Low, Medium, High, Extra High xhigh) via thinking_level in the Google Interactions API.",
            optThinkingXHigh: "Extra High (xhigh • Maximum Hydrogen / Neon Depth)",
            optThinkingHigh: "High (Deep Reasoning)",
            optThinkingMedium: "Medium (Balanced • Recommended)",
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
            loadingSub: "Brewing your summary with GDG Ottawa holiday cheer & cozy vibes ☕🎄",
            errorTitleDefault: "Unable to generate summary",
            btnCopy: "Copy Summary",
            btnCopied: "Copied!",
            btnDownload: "Download .md",
            btnViewTranscript: "View Transcript",
            btnHideTranscript: "Hide Transcript",
            titleTranscript: "Full Transcript",
            footerText: "Built for <strong>GDG Ottawa — Learn, Build &amp; Jingle</strong> 🎄✨ • Virtual Holiday Workshop (Dec 15, 2026) • Powered by <strong>Tokens &amp; Hot Cocoa</strong>",
            transcriptLines: "lines",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        },
        bi: {
            pageTitle: "Sommaire Vidéo IA • AI Video Summarizer | GDG Ottawa — Learn, Build & Jingle",
            langLabel: "Langue / Language:",
            tablistLabel: "Source média / Media source",
            titlePrefix: "Sommaire Vidéo",
            subtitle: "Codelab Google festif / Festive Google Codelab • GDG Ottawa",
            eventMeta: "🎄 Atelier virtuel / Virtual Workshop • 15 déc. / Dec 15, 2026 • 17h–19h / 5:00–7:00 PM EST ☕",
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
            tagLocalServer: "Modèle local / Local Model",
            descGemma4: "Modèle local privé via Ollama / Private local model via Ollama.",
            tagLemonade: "Modèle local / Local Model",
            descLemonade: "Modèle local privé via Lemonade Server / Private local model via Lemonade Server.",
            tagHydrogen: "Rapide / Fast • 1M",
            descHydrogen: "Vitesse élevée &amp; raisonnement efficace (1M) / Fast &amp; efficient reasoning (1M).",
            tagNeon: "Équilibré / Balanced • 1M",
            descNeon: "Intelligence quasi-pointe &amp; rapidité élevée (1M) / Near-flagship intelligence &amp; speed (1M).",
            tagArgon: "Raisonnement / Reasoning • 1M",
            descArgon: "Raisonnement approfondi &amp; analyse complexe / Deep multimodal reasoning.",
            tagCarbon: "Pointe / Frontier • 1M",
            descCarbon: "Raisonnement de pointe maximal / Maximum frontier reasoning (1M).",
            labelLocalVariant: "Modèle chargé Ollama / Loaded Model:",
            optOllamaEmpty: "Aucun modèle chargé dans Ollama / No loaded models in Ollama",
            optOllamaOffline: "Ollama hors ligne / Ollama server offline (http://127.0.0.1:11434)",
            btnRefreshModels: "Actualiser / Refresh",
            noteLocalServer: "Vérification des modèles chargés dans Ollama (/api/ps)...",
            noteOllamaEmpty: "Aucun modèle chargé en mémoire. Chargez un modèle dans Ollama puis Actualiser / Load a model in Ollama, then Refresh.",
            labelLemonadeVariant: "Modèle chargé Lemonade / Loaded Model:",
            optLemonadeEmpty: "Aucun modèle chargé dans Lemonade / No loaded models in Lemonade",
            optLemonadeOffline: "Lemonade hors ligne / Lemonade Server offline (http://127.0.0.1:13305)",
            noteLemonadeServer: "Vérification des modèles chargés dans Lemonade (/api/v1/health)...",
            noteLemonadeEmpty: "Aucun modèle chargé dans Lemonade / No loaded models in Lemonade. Load a model, then Refresh.",
            labelCarbonThinking: "Niveau de réflexion Gemini 4 Carbon / Reasoning Depth (Interactions API):",
            noteCarbonThinking: "Gemini 4 Carbon utilise le niveau Moyen par défaut / Uses Medium reasoning by default (Low, Medium, High via thinking_level).",
            labelArgonThinking: "Niveau de réflexion Gemini 4 Argon / Reasoning Depth (Interactions API):",
            labelNeonThinking: "Niveau de réflexion Gemini 4 Neon / Reasoning Depth (Interactions API):",
            noteNeonThinking: "Gemini 4 Neon supporte 4 niveaux / Supports 4 levels (Faible, Moyen, Élevé, Très élevé / Low, Medium, High, xhigh via thinking_level).",
            labelHydrogenThinking: "Niveau de réflexion Gemini 4 Hydrogen / Reasoning Depth (Interactions API):",
            noteHydrogenThinking: "Gemini 4 Hydrogen supporte 4 niveaux / Supports 4 levels (Faible, Moyen, Élevé, Très élevé / Low, Medium, High, xhigh via thinking_level).",
            optThinkingXHigh: "Très élevé / Extra High (xhigh • Hydrogen / Neon)",
            optThinkingHigh: "Élevé / High (Raisonnement approfondi / Deep Reasoning)",
            optThinkingMedium: "Moyen / Medium (Équilibré • Recommandé / Balanced • Recommended)",
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
            loadingSub: "Magie des Fêtes GDG Ottawa / Brewing with GDG Ottawa holiday cheer ☕🎄",
            errorTitleDefault: "Impossible de générer le sommaire / Unable to generate summary",
            btnCopy: "Copier / Copy",
            btnCopied: "Copié ! / Copied!",
            btnDownload: "Télécharger .md / Download .md",
            btnViewTranscript: "Voir la transcription / View Transcript",
            btnHideTranscript: "Masquer la transcription / Hide Transcript",
            titleTranscript: "Transcription complète / Full Transcript",
            footerText: "Conçu pour / Built for <strong>GDG Ottawa — Learn, Build &amp; Jingle</strong> 🎄✨ • 15 déc. / Dec 15, 2026 • <strong>Tokens &amp; Hot Cocoa</strong>",
            transcriptLines: "lignes / lines",
            ytPlaceholder: "https://www.youtube.com/watch?v=..."
        }
    };

    function formatOllamaOptionLabel(m) {
        let labelText = m.name;
        const meta = [];
        if (m.parameter_size) meta.push(m.parameter_size);
        if (m.size_vram_gb) {
            const unitLabel = state.currentLang === 'fr' ? 'Go' : 'GB';
            meta.push(`${m.size_vram_gb} ${unitLabel} VRAM`);
        } else if (m.size_gb) {
            const unitLabel = state.currentLang === 'fr' ? 'Go' : 'GB';
            meta.push(`${m.size_gb} ${unitLabel}`);
        }
        if (meta.length > 0) {
            labelText += ` (${meta.join(' • ')})`;
        }
        return labelText;
    }

    function renderOllamaSelectOptions() {
        const selectEl = document.getElementById('ollama-model-select');
        if (!selectEl) return;

        const dict = translations[state.currentLang] || translations.bi;
        if (state.availableOllamaModels.length === 0) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.disabled = true;
            emptyOpt.selected = true;
            emptyOpt.textContent = state.ollamaOffline ? dict.optOllamaOffline : dict.optOllamaEmpty;
            selectEl.replaceChildren(emptyOpt);
            selectEl.disabled = true;
            state.selectedOllamaVariant = '';
            return;
        }

        const currentVal = state.selectedOllamaVariant || selectEl.value;
        selectEl.disabled = false;
        let preferredFound = false;

        const options = state.availableOllamaModels.map(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = formatOllamaOptionLabel(m);
            if (m.name === currentVal) {
                opt.selected = true;
                state.selectedOllamaVariant = m.name;
                preferredFound = true;
            }
            return opt;
        });

        selectEl.replaceChildren(...options);

        if (!preferredFound && state.availableOllamaModels.length > 0) {
            selectEl.selectedIndex = 0;
            state.selectedOllamaVariant = state.availableOllamaModels[0].name;
        }
    }

    function updateOllamaModelNote(modelName) {
        const noteEl = document.getElementById('ollama-model-note');
        if (!noteEl) return;

        const dict = translations[state.currentLang] || translations.bi;
        const found = state.availableOllamaModels.find(m => m.name === modelName);
        const isEn = state.currentLang === 'en';
        const isFr = state.currentLang === 'fr';

        if (found) {
            const prefix = isEn ? "Loaded in Ollama: " : (isFr ? "Chargé dans Ollama : " : "Chargé / Loaded in Ollama: ");
            const sizeLabel = isEn ? "Size:" : (isFr ? "Taille :" : "Taille / Size:");
            const unitLabel = isFr ? "Go" : "GB";
            let text = `${prefix}<strong>${escapeHtml(found.name)}</strong>`;
            if (found.parameter_size) text += ` • ${sizeLabel} ${escapeHtml(found.parameter_size)}`;
            if (found.size_vram_gb) text += ` (${escapeHtml(found.size_vram_gb)} ${unitLabel} VRAM)`;
            else if (found.size_gb) text += ` (${escapeHtml(found.size_gb)} ${unitLabel})`;
            noteEl.innerHTML = text;
        } else if (!state.ollamaLoadedFetched) {
            noteEl.textContent = dict.noteLocalServer;
        } else if (state.ollamaOffline) {
            noteEl.textContent = dict.optOllamaOffline;
        } else {
            noteEl.textContent = dict.noteOllamaEmpty;
        }
    }

    function formatLemonadeOptionLabel(m) {
        let labelText = m.name;
        const meta = [m.recipe, m.device].filter(Boolean);
        if (meta.length > 0) {
            labelText += ` (${meta.join(' • ')})`;
        }
        return labelText;
    }

    function renderLemonadeSelectOptions() {
        const selectEl = document.getElementById('lemonade-model-select');
        if (!selectEl) return;

        const dict = translations[state.currentLang] || translations.bi;
        if (state.availableLemonadeModels.length === 0) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.disabled = true;
            emptyOpt.selected = true;
            emptyOpt.textContent = state.lemonadeOffline ? dict.optLemonadeOffline : dict.optLemonadeEmpty;
            selectEl.replaceChildren(emptyOpt);
            selectEl.disabled = true;
            state.selectedLemonadeVariant = '';
            return;
        }

        const currentVal = state.selectedLemonadeVariant || selectEl.value;
        selectEl.disabled = false;
        let preferredFound = false;

        const options = state.availableLemonadeModels.map(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = formatLemonadeOptionLabel(m);
            if (m.name === currentVal) {
                opt.selected = true;
                state.selectedLemonadeVariant = m.name;
                preferredFound = true;
            }
            return opt;
        });

        selectEl.replaceChildren(...options);

        if (!preferredFound && state.availableLemonadeModels.length > 0) {
            selectEl.selectedIndex = 0;
            state.selectedLemonadeVariant = state.availableLemonadeModels[0].name;
        }
    }

    function updateLemonadeModelNote(modelName) {
        const noteEl = document.getElementById('lemonade-model-note');
        if (!noteEl) return;

        const dict = translations[state.currentLang] || translations.bi;
        const found = state.availableLemonadeModels.find(m => m.name === modelName);
        const isEn = state.currentLang === 'en';
        const isFr = state.currentLang === 'fr';

        if (found) {
            const prefix = isEn ? "Loaded in Lemonade: " : (isFr ? "Chargé dans Lemonade : " : "Chargé / Loaded in Lemonade: ");
            const unitLabel = isFr ? "Go" : "GB";
            let text = `${prefix}<strong>${escapeHtml(found.name)}</strong>`;
            const meta = [found.recipe, found.device].filter(Boolean);
            if (meta.length > 0) text += ` • ${escapeHtml(meta.join(' • '))}`;
            if (found.size_gb) text += ` (${escapeHtml(found.size_gb)} ${unitLabel})`;
            if (found.context_length) text += ` • ${escapeHtml(found.context_length)} ctx`;
            noteEl.innerHTML = text;
        } else if (!state.lemonadeLoadedFetched) {
            noteEl.textContent = dict.noteLemonadeServer;
        } else if (state.lemonadeOffline) {
            noteEl.textContent = dict.optLemonadeOffline;
        } else {
            noteEl.textContent = dict.noteLemonadeEmpty;
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
        renderLemonadeSelectOptions();
        updateLemonadeModelNote(state.selectedLemonadeVariant);
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
            state.ollamaLoadedFetched = true;
            if (res.ok) {
                const data = await res.json();
                state.ollamaOffline = !data.success;
                state.availableOllamaModels = data.success && Array.isArray(data.models) ? data.models : [];
            } else {
                state.ollamaOffline = true;
                state.availableOllamaModels = [];
            }
        } catch (err) {
            state.ollamaLoadedFetched = true;
            state.ollamaOffline = true;
            state.availableOllamaModels = [];
            console.warn("Could not load local Ollama models:", err);
        } finally {
            renderOllamaSelectOptions();
            updateOllamaModelNote(state.selectedOllamaVariant);
            if (refreshIcon) {
                refreshIcon.classList.remove('fa-spin');
            }
        }
    }

    async function loadLemonadeModels(isManualRefresh = false) {
        const refreshIcon = document.getElementById('refresh-lemonade-icon');
        if (refreshIcon && isManualRefresh) {
            refreshIcon.classList.add('fa-spin');
        }

        try {
            const fetchOpts = isManualRefresh ? {} : { priority: 'low' };
            const res = await fetch('/api/lemonade/models', fetchOpts);
            state.lemonadeLoadedFetched = true;
            if (res.ok) {
                const data = await res.json();
                state.lemonadeOffline = !data.success;
                state.availableLemonadeModels = data.success && Array.isArray(data.models) ? data.models : [];
            } else {
                state.lemonadeOffline = true;
                state.availableLemonadeModels = [];
            }
        } catch (err) {
            state.lemonadeLoadedFetched = true;
            state.lemonadeOffline = true;
            state.availableLemonadeModels = [];
            console.warn("Could not load local Lemonade models:", err);
        } finally {
            renderLemonadeSelectOptions();
            updateLemonadeModelNote(state.selectedLemonadeVariant);
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
                if (!supportsHasSelector && songCard) songCard.classList.add('active');
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
        const isGeminiReasoning = (
            state.selectedModel === 'hydrogen' ||
            state.selectedModel === 'neon' ||
            state.selectedModel === 'argon' ||
            state.selectedModel === 'carbon'
        );
        container.classList.toggle('hidden', !isGeminiReasoning);
        if (!isGeminiReasoning) return;

        const supportsXHigh = state.selectedModel === 'hydrogen' || state.selectedModel === 'neon';
        const xhighOption = document.getElementById('opt-thinking-xhigh');
        const thinkingSelect = document.getElementById('argon-thinking-select');
        if (xhighOption) {
            xhighOption.hidden = !supportsXHigh;
            xhighOption.disabled = !supportsXHigh;
        }
        if (!supportsXHigh && thinkingSelect && thinkingSelect.value === 'xhigh') {
            thinkingSelect.value = 'medium';
        }

        const dict = translations[state.currentLang] || translations.bi;
        const labelEl = document.getElementById('argon-thinking-label-text');
        const noteEl = document.getElementById('argon-thinking-note');

        const modelConfig = {
            carbon: ['labelCarbonThinking', 'noteCarbonThinking'],
            neon: ['labelNeonThinking', 'noteNeonThinking'],
            hydrogen: ['labelHydrogenThinking', 'noteHydrogenThinking'],
            argon: ['labelArgonThinking', 'noteArgonThinking'],
        };
        const [labelKey, noteKey] = modelConfig[state.selectedModel] || modelConfig.argon;
        if (labelEl) {
            labelEl.setAttribute('data-i18n', labelKey);
            if (dict[labelKey]) labelEl.textContent = dict[labelKey];
        }
        if (noteEl) {
            noteEl.setAttribute('data-i18n', noteKey);
            if (dict[noteKey]) noteEl.textContent = dict[noteKey];
        }
    }

    function selectModel(modelKey) {
        state.selectedModel = modelKey;

        if (!supportsHasSelector) {
            document.querySelectorAll('.model-card').forEach(card => card.classList.remove('active'));
        }
        const activeCard = document.getElementById(`card-${modelKey}`);
        if (activeCard) {
            if (!supportsHasSelector) {
                activeCard.classList.add('active');
            }
            const radio = activeCard.querySelector('input[type="radio"]');
            if (radio && !radio.checked) radio.checked = true;
        }

        const ollamaVariantBox = document.getElementById('ollama-variant-container');
        if (ollamaVariantBox) {
            ollamaVariantBox.classList.toggle('hidden', modelKey !== 'gemma4');
        }

        const lemonadeVariantBox = document.getElementById('lemonade-variant-container');
        if (lemonadeVariantBox) {
            lemonadeVariantBox.classList.toggle('hidden', modelKey !== 'lemonade');
        }
        if (modelKey === 'lemonade' && state.availableLemonadeModels.length === 0) {
            loadLemonadeModels();
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
            const thinkingLevel = thinkingSelect ? thinkingSelect.value : 'medium';
            const isFr = state.currentLang === 'fr';
            const isEn = state.currentLang === 'en';
            const reasonPrefix = isFr ? 'réflexion' : (isEn ? 'reasoning' : 'réflexion / reasoning');
            if (modelUsedLabel === 'carbon' || modelUsedLabel === 'gemini-4-carbon') {
                displayLabel = `Gemini (gemini-4-carbon • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel === 'hydrogen' || modelUsedLabel === 'gemini-4-hydrogen') {
                displayLabel = `Gemini (gemini-4-hydrogen • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel === 'neon' || modelUsedLabel === 'neo' || modelUsedLabel === 'gemini-4-neon') {
                displayLabel = `Gemini (gemini-4-neon • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel === 'argon' || modelUsedLabel === 'gemini-4-argon') {
                displayLabel = `Gemini (gemini-4-argon • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel === 'flash' || modelUsedLabel === 'gemini-3.8-flash') {
                displayLabel = `Gemini (gemini-3.8-flash • ${reasonPrefix}: ${thinkingLevel})`;
            } else if (modelUsedLabel.startsWith('lemonade:')) {
                displayLabel = `Lemonade (${modelUsedLabel.slice('lemonade:'.length)})`;
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
        } else if (errMsg.includes("Lemonade")) {
            errTitle = state.currentLang === 'en' ? "Local Model Error (Lemonade)" : "Erreur Modèle Local (Lemonade)";
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
            if (done) {
                buffer += decoder.decode();
            } else {
                buffer += decoder.decode(value, { stream: true });
            }

            const lines = buffer.split('\n');
            buffer = done ? '' : (lines.pop() || '');

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
            if (done) break;
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

        if (state.selectedModel === 'gemma4' && !state.selectedOllamaVariant) {
            const ollamaSelect = document.getElementById('ollama-model-select');
            if (ollamaSelect) ollamaSelect.focus();
            showError(
                state.currentLang === 'en'
                    ? "No loaded models found in Ollama. Load a model in Ollama and click Refresh."
                    : "Aucun modèle chargé détecté dans Ollama. Chargez un modèle dans Ollama puis cliquez sur Actualiser."
            );
            return;
        }
        if (state.selectedModel === 'lemonade' && !state.selectedLemonadeVariant) {
            const lemonadeSelect = document.getElementById('lemonade-model-select');
            if (lemonadeSelect) lemonadeSelect.focus();
            showError(
                state.currentLang === 'en'
                    ? "No loaded models found in Lemonade Server. Load a model in Lemonade Server and click Refresh."
                    : "Aucun modèle chargé détecté dans Lemonade Server. Chargez un modèle dans Lemonade Server puis cliquez sur Actualiser."
            );
            return;
        }

        const effectiveModel = (state.selectedModel === 'gemma4')
            ? state.selectedOllamaVariant
            : (state.selectedModel === 'lemonade')
                ? `lemonade:${state.selectedLemonadeVariant}`
                : state.selectedModel;
        const effectiveApiKey = (state.selectedModel === 'lemonade' || state.selectedModel === 'gemma4')
            ? null
            : (apiKey || null);
        const thinkingSelect = document.getElementById('argon-thinking-select');
        const thinkingLevel = thinkingSelect ? thinkingSelect.value : 'medium';
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
                        api_key: effectiveApiKey,
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
                if (effectiveApiKey) formData.append('api_key', effectiveApiKey);

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

        populateResultHeader(data.metadata, data.transcript_info, data.model_used || 'Ollama');
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
        const filename = `${cleanTitle}_gdg_ottawa_summary.md`;

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
        loadLemonadeModels();

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

        // Song Mode checkbox active visual sync (fallback when :has() is unsupported)
        const songCheckbox = document.getElementById('song-mode-checkbox');
        const songCard = document.getElementById('song-mode-card');
        if (!supportsHasSelector && songCheckbox && songCard) {
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

        // Lemonade variant select & manual refresh
        const lemonadeSelect = document.getElementById('lemonade-model-select');
        if (lemonadeSelect) {
            lemonadeSelect.addEventListener('change', () => {
                state.selectedLemonadeVariant = lemonadeSelect.value;
                updateLemonadeModelNote(lemonadeSelect.value);
            });
        }

        const refreshLemonadeBtn = document.getElementById('btn-refresh-lemonade-models');
        if (refreshLemonadeBtn) {
            refreshLemonadeBtn.addEventListener('click', () => loadLemonadeModels(true));
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
