(function () {
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

    function ensureStyles() {
        if (document.getElementById('word-rating-module-styles')) return;

        const style = document.createElement('style');
        style.id = 'word-rating-module-styles';
        style.textContent = `
#rating {
    font-size: 2.2rem;
    font-weight: bold;
    margin: 20px 0 10px;
    letter-spacing: 4px;
}

.rating-TRASH { color: #666; }
.rating-COMMON { color: #aaa; }
.rating-RARE { color: #4fc3f7; text-shadow: 0 0 20px #4fc3f7; }
.rating-EPIC { color: #ab47bc; text-shadow: 0 0 20px #ab47bc; }
.rating-MYTHIC { color: #ffd700; animation: mythicGlow 2s ease-in-out infinite; }

@keyframes mythicGlow {
    0%, 100% { text-shadow: 0 0 20px #ffd700, 0 0 40px #ffa500; }
    50% { text-shadow: 0 0 40px #ffd700, 0 0 80px #ffa500, 0 0 120px #ff6600; }
}

#score {
    font-size: 1.8rem;
    margin: 10px 0;
    color: #ccc;
}

#breakdown {
    text-align: left;
    background: #1a1a2e;
    border-radius: 8px;
    padding: 20px;
    margin-top: 20px;
    max-height: 400px;
    overflow-y: auto;
}

#breakdown h3 {
    margin-bottom: 12px;
    color: #667eea;
    font-size: 1rem;
}

.breakdown-item {
    padding: 6px 0;
    border-bottom: 1px solid #252540;
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
}

.breakdown-item:last-child {
    border-bottom: none;
}

.breakdown-item .points {
    color: #4caf50;
    font-weight: bold;
}
`;
        document.head.appendChild(style);
    }

    function getRating(totalScore) {
        if (totalScore < 2000) return { rating: 'TRASH', ratingClass: 'rating-TRASH' };
        if (totalScore < 3000) return { rating: 'COMMON', ratingClass: 'rating-COMMON' };
        if (totalScore < 10000) return { rating: 'RARE', ratingClass: 'rating-RARE' };
        if (totalScore < 18000) return { rating: 'EPIC', ratingClass: 'rating-EPIC' };
        return { rating: 'MYTHIC', ratingClass: 'rating-MYTHIC' };
    }

    const SPECIAL_LETTER_POINTS = 1500;

    function createSpecialLetterBreakdownItem(letter, cnt) {
        return { desc: `包含字母 "${letter}" ${cnt} 个`, points: SPECIAL_LETTER_POINTS * cnt };
    }

    function scoreCharacters(characters) {
        let word = '';
        
        for (let i = 0; i < 6; i++) {
            const c = generated[i];
            if (c != ' ') {
                wordStarted = true;
                word += c;
            }
        }
        
        const wordLength = word.length;
        document.getElementById('word-text').textContent = `「${word || '(空)'}」`;
        
        const breakdown = [];
        let totalScore = 0;
        
        // 长度为0奇迹处理
        if (wordLength === 0) {
            breakdown.push({ desc: '单词长度为 0（奇迹！）', points: 888888 });
            totalScore = 888888;
            return { word, totalScore, breakdown, ...getRating(totalScore) };
            return;
        }
        
        // 长度得分
        const lengthScores = { 6: 250, 5: 888, 4: 3000, 3: 7878, 2: 91919, 1: 137891 };
        
        const pts = lengthScores[wordLength] || 10;
        breakdown.push({ desc: `单词长度为 ${wordLength}`, points: pts });
        totalScore += pts;
        
        // 仅字母部分 (去掉下划线占位符)
        const letters = word.replace(/_/g, '');
        
        // 连续模式检测（字母表连续 / 相同字母）
        const letterRuns = word.split('_').filter(r => r.length > 0);
        let hasConsec = [false, false, false, false]; // 3,4,5,6
        let hasSame = [false, false, false, false];
        for (const run of letterRuns) {
            for (let len = 3; len <= Math.min(6, run.length); len++) {
                for (let i = 0; i <= run.length - len; i++) {
                    const sub = run.substring(i, i + len);
                    
                    // 字母表连续（升序或降序）
                    let asc = true, desc = true;
                    for (let j = 1; j < sub.length; j++) {
                        if (sub.charCodeAt(j) - sub.charCodeAt(j - 1) !== 1) asc = false;
                        if (sub.charCodeAt(j - 1) - sub.charCodeAt(j) !== 1) desc = false;
                    }
                    if (asc || desc) hasConsec[len - 3] = true;
                    
                    // 相同字母
                    let same = true;
                    for (let j = 1; j < sub.length; j++) {
                        if (sub[j] !== sub[0]) { same = false; break; }
                    }
                    if (same) hasSame[len - 3] = true;
                }
            }
        }
        const consecScores = [4046, 6666, 11451, 24999];
        const consecLabels = [3, 4, 5, 6];
        for (let i = 0; i < 4; i++) {
            if (hasConsec[i]) {
                breakdown.push({ desc: `连续 ${consecLabels[i]} 位字母在字母表中连续`, points: consecScores[i] });
                totalScore += consecScores[i];
            }
            if (hasSame[i]) {
                breakdown.push({ desc: `连续 ${consecLabels[i]} 位相同字母`, points: consecScores[i] });
                totalScore += consecScores[i];
            }
        }
        
        // 回文子串 (长度>=3)
        let hasPalindrome = false;
        for (const run of letterRuns) {
            for (let len = 3; len <= run.length && !hasPalindrome; len++) {
                for (let i = 0; i <= run.length - len && !hasPalindrome; i++) {
                    const sub = run.substring(i, i + len);
                    if (sub === sub.split('').reverse().join('')) hasPalindrome = true;
                }
            }
        }
        if (hasPalindrome) {
            breakdown.push({ desc: '包含回文子串', points: 3333 });
            totalScore += 3333;
        }
        
        if (new Set(word.split('')).size === wordLength) {
            breakdown.push({ desc: '所有字母互不相同', points: 2046 });
            totalScore += 2046;
        }
        // 字母配对
        if (letters.includes('i') && letters.includes('j') && letters.includes('k')) {
            breakdown.push({ desc: '同时包含 i,j,k', points: 7777 });
            totalScore += 7777;
        }

        if (letters.includes('x') && letters.includes('y') && letters.includes('z')) {
            breakdown.push({ desc: '同时包含 x,y,z', points: 7777 });
            totalScore += 7777;
        }

        if (letters.includes('a') && letters.includes('b') && letters.includes('c')) {
            breakdown.push({ desc: '同时包含 a,b,c', points: 7777 });
            totalScore += 7777;
        }

        if (letters.includes('l') && letters.includes('r')) {
            breakdown.push({ desc: '同时包含 l,r', points: 3333 });
            totalScore += 3333;
        }

        if (letters.includes('p') && letters.includes('q')) {
            breakdown.push({ desc: '同时包含 p,q', points: 3333 });
            totalScore += 3333;
        }

        if (letters.includes('u') && letters.includes('v')) {
            breakdown.push({ desc: '同时包含 u,v', points: 3333 });
            totalScore += 3333;
        }

        if (letters.includes('s') && letters.includes('t')) {
            breakdown.push({ desc: '同时包含 s,t', points: 3333 });
            totalScore += 3333;
        }
        
        // 元音计数
        let vowelCount = 0;
        for (const c of letters) { if (VOWELS.has(c)) vowelCount++; }
        if (vowelCount > 0) {
            breakdown.push({ desc: `包含 ${vowelCount} 个元音字母`, points: vowelCount * 1333 });
            totalScore += vowelCount * 1333;
        }
        
        // 非特殊字母排名加分
        let posScore = 0;
        const posDetails = [];
        for (const c of letters) {
            const rank = c.charCodeAt(0) - 96;
            posScore += rank;
            posDetails.push(`${c}(${rank})`);
        }
        if (posScore > 0) {
            breakdown.push({ desc: `字母排名加分: ${posDetails.join(' + ')}`, points: posScore * 10});
            totalScore += posScore * 10;
        }
        
        // 自由补充规则
        // 整词回文
        if (letters.length >= 3 && letters === letters.split('').reverse().join('')) {
            breakdown.push({ desc: '✨ 整个单词为回文', points: 8888 });
            totalScore += 8888;
        }
        
        // 首尾相同
        if (letters.length >= 2 && letters[0] === letters[letters.length - 1]) {
            breakdown.push({ desc: '首尾字母相同', points: 1649 });
            totalScore += 1649;
        }
        
        // 纯辅音
        if (letters.length > 0 && vowelCount === 0) {
            breakdown.push({ desc: '纯辅音单词', points: 2111 });
            totalScore += 2111;
        }

        if (letters.length > 0 && vowelCount === wordLength) {
            breakdown.push({ desc: '✨ 纯元音单词', points: 8888 });
            totalScore += 8888;
        }
        
        // 包含 "gg"
        if (word.includes('gg')) {
            breakdown.push({ desc: '包含 "gg"（Good Game!）', points: 3999 });
            totalScore += 3999;
        }
        
        // 字母半区
        if (letters.length >= 3) {
            if ([...letters].every(c => c.charCodeAt(0) <= 109)) {
                breakdown.push({ desc: '所有字母来自前半字母表 (a-m)', points: 1145 });
                totalScore += 1145;
            }
            if ([...letters].every(c => c.charCodeAt(0) >= 110)) {
                breakdown.push({ desc: '所有字母来自后半字母表 (n-z)', points: 1145 });
                totalScore += 1145;
            }
        }
        
        // 元音辅音交替
        if (letters.length >= 4) {
            let alt = true;
            for (let i = 1; i < letters.length; i++) {
                if (VOWELS.has(letters[i]) === VOWELS.has(letters[i - 1])) { alt = false; break; }
            }
            if (alt) {
                breakdown.push({ desc: '✨ 元音辅音完美交替', points: 6666 });
                totalScore += 6666;
            }
        }

        return { word, totalScore, breakdown, ...getRating(totalScore) };
    }

    function renderResult(result, elements) {
        const wordTextEl = elements.wordText;
        const ratingEl = elements.rating;
        const scoreEl = elements.score;
        const restartBtn = elements.restartButton;
        const breakdownEl = elements.breakdown;

        wordTextEl.textContent = `「${result.word || '(空)'}」`;

        setTimeout(() => {
            ratingEl.textContent = result.rating;
            ratingEl.className = result.ratingClass + ' fade-in';
        }, 200);

        setTimeout(() => {
            scoreEl.className = 'fade-in';
            let cur = 0;
            const step = Math.max(1, Math.floor(result.totalScore / 40));
            const iv = setInterval(() => {
                cur += step;
                if (cur >= result.totalScore) { cur = result.totalScore; clearInterval(iv); }
                scoreEl.textContent = `${cur} points`;
            }, 25);
        }, 600);

        setTimeout(() => {
            restartBtn.style.display = 'inline-block';
            restartBtn.className = 'btn fade-in';
        }, 1000);

        setTimeout(() => {
            breakdownEl.className = 'fade-in';
            breakdownEl.innerHTML = '<h3>📊 得分明细</h3>';
            result.breakdown.forEach(item => {
                const div = document.createElement('div');
                div.className = 'breakdown-item';
                div.innerHTML = `<span>${item.desc}</span><span class="points">+ ${item.points}</span>`;
                breakdownEl.appendChild(div);
            });
            const total = document.createElement('div');
            total.className = 'breakdown-item';
            total.style.cssText = 'border-top:2px solid #667eea;margin-top:8px;padding-top:8px;font-weight:bold;';
            total.innerHTML = `<span>总计</span><span class="points">${result.totalScore} points</span>`;
            breakdownEl.appendChild(total);
        }, 1200);
    }
    function mount(options) {
        ensureStyles();
        const result = scoreCharacters(options.characters);
        renderResult(result, options.elements);
        return result;
    }

    window.WordRating = {
        ensureStyles,
        scoreCharacters,
        renderResult,
        mount
    };

    ensureStyles();
})();
