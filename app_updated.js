// UPDATED PARTS ONLY - merge into your app.js

function getMonthlyGross(profile, year, month) {
  const s = profile.settings;
  const mE = monthEntries(year, month);

  let gross = profile.mode === 'monthly' ? (s.monthlyBase || 0) : 0;
  gross += (s.commutation || 0);

  mE.forEach(e => {
    const c = calcDay(e, profile);
    if (c) gross += c.pay;
  });

  return gross;
}

// Example usage for earnings fix
function computeNet() {
  const gross = getMonthlyGross(currentProfile, calYear, calMonth);

  const ym  = yearMonthKey(calYear, calMonth);
  const ded = getDeductions(ym);
  const totalDed = Object.values(ded).reduce((a,b)=>a+(+b||0), 0);

  const net = gross - totalDed;
  return { gross, totalDed, net };
}

// Auto fill fix
function safeFill(el, autoVal) {
  if (!el.value) el.value = autoVal;
}
