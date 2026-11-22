const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateSelection(content, answers, weights = {}, quizId = 'curt') {
  if (!record(answers) || !record(weights)) throw new Error('Les respostes i els pesos han de ser objectes.');
  const quizzes = content.quizzes ?? [{ id: 'curt', name: 'Test curt', questionIds: content.questions.map(q => q.id) }];
  const quiz = quizzes.find(item => item.id === quizId);
  if (!quiz) throw new Error('Aquest test no existeix.');
  const bank = new Map(content.questions.map(q => [q.id, q]));
  const questionMap = new Map(quiz.questionIds.map(id => [id, bank.get(id)]));
  for (const [id, option] of Object.entries(answers)) {
    if (!questionMap.get(id)?.options.some(o => o.id === option)) throw new Error('Hi ha una pregunta o resposta desconeguda.');
  }
  for (const [id, weight] of Object.entries(weights)) {
    if (!questionMap.has(id) || ![1, 2].includes(weight)) throw new Error('La importància ha de ser 1 o 2.');
  }
  return { quiz, questionMap };
}

function scoreQuiz(content, answers, weights = {}, quizId = 'curt') {
  const { quiz, questionMap } = validateSelection(content, answers, weights, quizId);
  const answeredCount = Object.keys(answers).length;
  const scaleVersion = content.methodology?.scaleVersion ?? 1;
  const compatibleWeight = content.methodology?.compatibleWeight ?? 1;
  const parties = content.parties.map(party => {
    let sum = 0, denominator = 0, decisive = 0;
    const details = [];
    for (const [id, answer] of Object.entries(answers)) {
      const question = questionMap.get(id);
      const position = question.positions?.[party.id];
      const similarity = position?.scores?.[answer];
      if (typeof similarity !== 'number' || !Number.isFinite(similarity) || similarity < -1 || similarity > 1) continue;
      const weight = weights[id] ?? 1;
      sum += similarity * weight;
      // Escala 3: una mesura compatible (0) pot comptar només una part del pes al denominador.
      const counted = similarity === 0 && scaleVersion >= 3 ? weight * compatibleWeight : weight;
      denominator += counted;
      if (counted > 0) decisive++;
      details.push({ questionId: id, questionTitle: question.title, topic: question.topic,
        selectedText: question.options.find(o => o.id === answer).text, similarity, weight,
        rationale: position.rationale, sourceRefs: position.sourceRefs });
    }
    // La cobertura compta totes les respostes amb posició documentada, també les compatibles.
    const coverage = answeredCount ? Math.round(details.length / answeredCount * 100) : 0;
    // L'índex no es mostra mai per sota de 0%; el balanç sense límit (rawScore) serveix per ordenar els partits a 0%.
    const rawScore = denominator ? Math.round(sum / denominator * 100) : null;
    return { ...party, score: rawScore === null ? null : Math.max(0, rawScore), rawScore,
      coverage, knownCount: details.length, decisiveCount: decisive, eligible: denominator > 0,
      details };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.rawScore ?? -1e9) - (a.rawScore ?? -1e9) || a.shortName.localeCompare(b.shortName, 'ca'));
  return { version: content.version, scaleVersion: content.methodology?.scaleVersion ?? 1, compatibleWeight: content.methodology?.compatibleWeight ?? 1, quizId: quiz.id, quizName: quiz.name, answeredCount, totalQuestions: questionMap.size, parties };
}

window.AfinitatScoring = { scoreQuiz, validateSelection };
