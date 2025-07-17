

import { useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';
import Papa from 'papaparse';
import './App.css';

function App() {
  // DEBUG: Confirm rendering
  if (typeof window !== 'undefined') window.__APP_RENDERED = true;
  // Load from localStorage or use defaults
  const [data, setData] = useState([]);
  const [rules, setRules] = useState([]);
  const [ruleInput, setRuleInput] = useState('');
  const [ruleNameInput, setRuleNameInput] = useState('');
  const [ruleOrder, setRuleOrder] = useState([]);
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState('');
  const [fatalError, setFatalError] = useState(null);
  const [groupFields, setGroupFields] = useState(['Rule']);
  const [sumField, setSumField] = useState('');

  // Load from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const d = await get('app_data');
        if (d) setData(d);
        const r = await get('app_rules');
        if (r) setRules(r.map(rule => ({ ...rule, fn: buildRuleFn(rule.text) })));
        const o = await get('app_ruleOrder');
        if (o) setRuleOrder(o);
        const g = await get('app_groupFields');
        if (g) setGroupFields(g);
        const s = await get('app_sumField');
        if (s) setSumField(s);
      } catch (err) {
        setMessage('Failed to load from IndexedDB: ' + err.message);
      }
    })();
    // eslint-disable-next-line
  }, []);


  // CSV/Excel file import
  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setData(results.data);
          setMessage('CSV imported successfully.');
        },
        error: (err) => setMessage('CSV Parse Error: ' + err.message)
      });
    } else {
      setMessage('Only CSV import is supported in this demo.');
    }
  };

  // Persist to IndexedDB on change
  useEffect(() => { set('app_data', data); }, [data]);
  useEffect(() => { set('app_rules', rules.map(({name,text})=>({name,text}))); }, [rules]);
  useEffect(() => { set('app_ruleOrder', ruleOrder); }, [ruleOrder]);
  useEffect(() => { set('app_groupFields', groupFields); }, [groupFields]);
  useEffect(() => { set('app_sumField', sumField); }, [sumField]);


  // NLP rule input (simple stub)
  // Apply rules to data and add Rule column
  const applyRules = (inputData = data, inputRules = rules, inputOrder = ruleOrder) => {
    if (!inputData.length || !inputRules.length) return inputData;
    const newData = inputData.map(row => {
      let ruleName = '';
      for (let idx of inputOrder) {
        const rule = inputRules[idx];
        if (rule && rule.fn(row)) {
          ruleName = rule.name;
          break;
        }
      }
      return { ...row, Rule: ruleName };
    });
    setData(newData);
    setMessage('Rules applied.');
    return newData;
  };

  // Edit mode state
  const [editIdx, setEditIdx] = useState(null);
  const [editRuleName, setEditRuleName] = useState('');
  const [editRuleText, setEditRuleText] = useState('');

  const handleAddRule = () => {
    const name = ruleNameInput.trim();
    if (!name) {
      setMessage('Rule name is required.');
      return;
    }
    if (rules.some(r => r.name === name)) {
      setMessage('Rule name must be unique.');
      return;
    }
    if (!ruleInput.trim()) {
      setMessage('Rule description is required.');
      return;
    }
    const newRules = [...rules, { name, text: ruleInput, fn: buildRuleFn(ruleInput) }];
    const newOrder = [...ruleOrder, rules.length];
    setRules(newRules);
    setRuleOrder(newOrder);
    setRuleInput('');
    setRuleNameInput('');
    setMessage('Rule added.');
    // Apply rules after adding
    applyRules(data, newRules, newOrder);
  };

  // Delete a rule
  const handleDeleteRule = (idx) => {
    // Remove rule from rules
    const newRules = rules.filter((_, i) => i !== idx);
    // Remove all occurrences of idx from ruleOrder, and reindex remaining
    const newOrder = ruleOrder
      .filter(i => i !== idx)
      .map(i => (i > idx ? i - 1 : i));
    setRules(newRules);
    setRuleOrder(newOrder);
    setMessage('Rule deleted.');
    applyRules(data, newRules, newOrder);
  };

  // Start editing a rule
  const handleEditRule = (idx) => {
    setEditIdx(idx);
    setEditRuleName(rules[idx].name);
    setEditRuleText(rules[idx].text);
  };

  // Save edited rule
  const handleSaveEditRule = (idx) => {
    const name = editRuleName.trim();
    if (!name) {
      setMessage('Rule name is required.');
      return;
    }
    if (rules.some((r, i) => r.name === name && i !== idx)) {
      setMessage('Rule name must be unique.');
      return;
    }
    if (!editRuleText.trim()) {
      setMessage('Rule description is required.');
      return;
    }
    const newRules = rules.map((r, i) =>
      i === idx ? { name, text: editRuleText, fn: buildRuleFn(editRuleText) } : r
    );
    setRules(newRules);
    setEditIdx(null);
    setEditRuleName('');
    setEditRuleText('');
    setMessage('Rule updated.');
    applyRules(data, newRules, ruleOrder);
  };

  // Cancel editing
  const handleCancelEditRule = () => {
    setEditIdx(null);
    setEditRuleName('');
    setEditRuleText('');
  };

  // Move rule up/down in order
  const moveRule = (idx, dir) => {
    const pos = ruleOrder.indexOf(idx);
    if (pos < 0) return;
    const newOrder = [...ruleOrder];
    if (dir === 'up' && pos > 0) {
      [newOrder[pos - 1], newOrder[pos]] = [newOrder[pos], newOrder[pos - 1]];
    } else if (dir === 'down' && pos < ruleOrder.length - 1) {
      [newOrder[pos + 1], newOrder[pos]] = [newOrder[pos], newOrder[pos + 1]];
    }
    setRuleOrder(newOrder);
    // Apply rules after reordering
    applyRules(data, rules, newOrder);
  };

  // Enhanced NLP rule parser: supports multiple conditions and operators
  function buildRuleFn(text) {
    // Example: "If Region is North and Sales > 1000"
    // Remove "if" and "then ..." parts
    let rule = text.trim().replace(/^if\s+/i, '').replace(/then.+$/i, '');
    // Split by ' and ' or ' or '
    let orParts = rule.split(/\s+or\s+/i);

    // Helper to get actual field name from row (case-insensitive)
    function getFieldKey(row, field) {
      const keys = Object.keys(row);
      const found = keys.find(k => k.toLowerCase() === field.toLowerCase());
      return found || field;
    }

    const parseCondition = cond => {
      // Supported: is, is not, =, ==, !=, >, <, >=, <=, contains, does not contain
      cond = cond.trim();
      let m;
      if ((m = cond.match(/^(\w+)\s*(=|==|is)\s*([\w.\- ]+)$/i))) {
        const field = m[1], value = m[3];
        return row => {
          const v1 = String(row[getFieldKey(row, field)] || '').trim().toLowerCase();
          const v2 = String(value).trim().toLowerCase();
          return v1 === v2;
        };
      }
      if ((m = cond.match(/^(\w+)\s*(!=|is not)\s*([\w.\- ]+)$/i))) {
        const field = m[1], value = m[3];
        return row => {
          const v1 = String(row[getFieldKey(row, field)] || '').trim().toLowerCase();
          const v2 = String(value).trim().toLowerCase();
          return v1 !== v2;
        };
      }
      if ((m = cond.match(/^(\w+)\s*>\s*([\d.]+)$/i))) {
        const field = m[1], value = parseFloat(m[2]);
        return row => parseFloat(row[getFieldKey(row, field)]) > value;
      }
      if ((m = cond.match(/^(\w+)\s*<\s*([\d.]+)$/i))) {
        const field = m[1], value = parseFloat(m[2]);
        return row => parseFloat(row[getFieldKey(row, field)]) < value;
      }
      if ((m = cond.match(/^(\w+)\s*>=\s*([\d.]+)$/i))) {
        const field = m[1], value = parseFloat(m[2]);
        return row => parseFloat(row[getFieldKey(row, field)]) >= value;
      }
      if ((m = cond.match(/^(\w+)\s*<=\s*([\d.]+)$/i))) {
        const field = m[1], value = parseFloat(m[2]);
        return row => parseFloat(row[getFieldKey(row, field)]) <= value;
      }
      if ((m = cond.match(/^(\w+)\s*contains\s*([\w.\- ]+)$/i))) {
        const field = m[1], value = m[2];
        return row => {
          const v1 = String(row[getFieldKey(row, field)] || '').toLowerCase();
          const v2 = String(value).toLowerCase();
          return v1.includes(v2);
        };
      }
      if ((m = cond.match(/^(\w+)\s*does not contain\s*([\w.\- ]+)$/i))) {
        const field = m[1], value = m[2];
        return row => {
          const v1 = String(row[getFieldKey(row, field)] || '').toLowerCase();
          const v2 = String(value).toLowerCase();
          return !v1.includes(v2);
        };
      }
      return () => false;
    };
    // Each orPart can have andParts
    const orFns = orParts.map(orPart => {
      const andParts = orPart.split(/\s+and\s+/i);
      const andFns = andParts.map(parseCondition);
      return row => andFns.every(fn => fn(row));
    });
    return row => orFns.some(fn => fn(row));
  }


  // Apply rules in user-specified order, add Rule column
  const handleApplyRules = () => {
    if (!data.length || !rules.length) {
      setMessage('Import data and add rules first.');
      return;
    }
    const newData = data.map(row => {
      let ruleName = '';
      for (let idx of ruleOrder) {
        const rule = rules[idx];
        if (rule && rule.fn(row)) {
          ruleName = rule.name;
          break;
        }
      }
      return { ...row, Rule: ruleName };
    });
    setData(newData);
    setMessage('Rules applied.');
  };


  // ...existing code...
  // Group by: preserve order of selection
  const handleGroupFieldsChange = (e) => {
    const prev = groupFields;
    const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
    // Add new selections to the end, preserve previous order for already-selected
    const newOrder = prev.filter(f => selected.includes(f)).concat(selected.filter(f => !prev.includes(f)));
    setGroupFields(newOrder);
  };

  // Summarize function
  const summarize = (inputData = data, inputGroupFields = groupFields, inputSumField = sumField) => {
    if (!inputData.length || !inputGroupFields.length) {
      setSummary(null);
      return;
    }
    const groups = {};
    inputData.forEach(row => {
      const key = inputGroupFields.map(f => row[f] || 'Unmatched').join(' | ');
      if (!groups[key]) groups[key] = { sum: 0, count: 0 };
      groups[key].count += 1;
      if (inputSumField) {
        const val = parseFloat(row[inputSumField]) || 0;
        groups[key].sum += val;
      }
    });
    const summaryArr = Object.entries(groups).map(([k, v]) => {
      const keys = k.split(' | ');
      const obj = {};
      inputGroupFields.forEach((f, i) => { obj[f] = keys[i]; });
      if (inputSumField) {
        obj['Sum'] = Math.round(v.sum);
      }
      obj['Count'] = v.count;
      return obj;
    });
    setSummary(summaryArr);
    setMessage('Summary generated.');
  };

  // Automatically summarize when data, groupFields, or sumField changes
  useEffect(() => {
    summarize();
    // eslint-disable-next-line
  }, [data, groupFields, sumField]);

  // UI
  try {
    return (
      <div className="win-app-window">
        <div className="win-titlebar">
          <span className="win-title">Data Import & NLP Rule Engine</span>
          <div className="win-titlebar-controls">
            <button className="win-btn" title="Minimize" tabIndex={-1} aria-label="Minimize">&#8211;</button>
            <button className="win-btn" title="Maximize" tabIndex={-1} aria-label="Maximize">&#9723;</button>
            <button className="win-btn win-close" title="Close" tabIndex={-1} aria-label="Close">&#10005;</button>
          </div>
        </div>
        <div className="win-content">
          {/* Left Pane: Rules and Data Import */}
          <div className="left-pane">
            <h1>Data & Rules</h1>
            {fatalError && (
              <div style={{background:'#f00',color:'#fff',padding:'1rem',marginBottom:'1rem',fontWeight:'bold'}}>FATAL ERROR: {fatalError.toString()}</div>
            )}
            {message && (
              <div style={{background:'#f8fafc',color:'#1e293b',padding:'0.75rem 1rem',borderRadius:6,marginBottom:16,border:'1px solid #cbd5e1'}}>
                {message}
              </div>
            )}
            <section className="win-section">
              <h2>1. Import Data</h2>
              <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileImport} />
              {data.length > 0 && (
                <>
                  <p>Imported {data.length} rows.</p>
                  <div style={{overflowX:'auto', maxHeight:120}}>
                    <table border="1" cellPadding="4" style={{fontSize:'0.9em'}}>
                      <thead>
                        <tr>
                          {Object.keys(data[0]).map((k,i) => <th key={i}>{k}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {data.slice(0,5).map((row,i) => (
                          <tr key={i}>
                            {Object.entries(row).map(([k,v],j) => {
                              const isNum = !isNaN(parseFloat(v)) && v !== '' && isFinite(v);
                              let display = v;
                              if (isNum && typeof v === 'string' && v.trim() !== '') {
                                const num = Number(v);
                                display = Number.isFinite(num) ? num.toLocaleString() : v;
                              }
                              return <td key={j} style={isNum ? {textAlign:'right'} : {}}>{display}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.length > 5 && <div>...showing first 5 rows</div>}
                  </div>
                </>
              )}
            </section>
            <section className="win-section">
              <h2>2. Specify Rules (NLP)</h2>
              <input
                type="text"
                value={ruleNameInput}
                onChange={e => setRuleNameInput(e.target.value)}
                placeholder="Rule name (unique)"
              />
              <input
                type="text"
                value={ruleInput}
                onChange={e => setRuleInput(e.target.value)}
                placeholder="e.g. If Sales > 1000"
              />
              <button style={{width:'100%',marginTop:8}} onClick={handleAddRule}>Add Rule</button>
              <ul>
                {ruleOrder.map((idx, i) => (
                  <li key={i} style={{marginBottom:4}}>
                    {editIdx === idx ? (
                      <>
                        <input
                          type="text"
                          value={editRuleName}
                          onChange={e => setEditRuleName(e.target.value)}
                          placeholder="Rule name (unique)"
                          style={{width:'40%',marginRight:4}}
                        />
                        <input
                          type="text"
                          value={editRuleText}
                          onChange={e => setEditRuleText(e.target.value)}
                          placeholder="Rule description"
                          style={{width:'40%',marginRight:4}}
                        />
                        <button style={{marginLeft:2}} onClick={()=>handleSaveEditRule(idx)}>Save</button>
                        <button style={{marginLeft:2}} onClick={handleCancelEditRule}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <b>{rules[idx]?.name}</b>: {rules[idx]?.text}
                        <button style={{marginLeft:8}} onClick={()=>moveRule(idx,'up')}>↑</button>
                        <button style={{marginLeft:2}} onClick={()=>moveRule(idx,'down')}>↓</button>
                        <button style={{marginLeft:8,background:'#e81123'}} onClick={()=>handleDeleteRule(idx)}>Delete</button>
                        <button style={{marginLeft:2}} onClick={()=>handleEditRule(idx)}>Edit</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          {/* Right Pane: Summary and Analysis */}
          <div className="right-pane">
            <h1>Summary & Analysis</h1>
            <section className="win-section">
              <h2>Group & Summarize</h2>
              <div>
              <label>Group by: </label>
              <select multiple value={groupFields} onChange={handleGroupFieldsChange}>
                {/* Always include 'Rule' as an option */}
                <option value="Rule">Rule</option>
                {data[0] && Object.keys(data[0])
                  .filter(k => k !== 'Rule' && k !== sumField)
                  .map((k,i) => {
                    // Count distinct values for this column
                    const values = new Set(data.map(row => row[k] ?? ''));
                    const tooMany = values.size > 50;
                    return (
                      <option key={i} value={k} disabled={tooMany} title={tooMany ? 'Too many distinct values to group by (>50)' : undefined}>
                        {k}{tooMany ? ' (too many values)' : ''}
                      </option>
                    );
                  })}
              </select>
              <label style={{marginLeft:8}}>Sum field: </label>
              <select value={sumField} onChange={e => setSumField(e.target.value)}>
                <option value="">(Row count only)</option>
                {data[0] && Object.keys(data[0]).filter(k=>k!=='Rule').map((k,i) => <option key={i} value={k}>{k}</option>)}
              </select>
              </div>
              {summary && (
                <div style={{overflowX:'auto',marginTop:16}}>
                  <table border="1" cellPadding="4">
                    <thead>
                      <tr>
                        {groupFields.map((f,i) => <th key={i}>{f}</th>)}
                        {sumField ? <th>Sum</th> : null}
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row,i) => (
                        <tr key={i}>
                          {groupFields.map((f,j) => {
                            const v = row[f];
                            const isNum = !isNaN(parseFloat(v)) && v !== '' && isFinite(v);
                            let display = v;
                            if (isNum && typeof v === 'string' && v.trim() !== '') {
                              const num = Number(v);
                              display = Number.isFinite(num) ? num.toLocaleString() : v;
                            }
                            return <td key={j} style={isNum ? {textAlign:'right'} : {}}>{display}</td>;
                          })}
                          {sumField ? <td style={{textAlign:'right'}}>{typeof row['Sum'] === 'number' ? row['Sum'].toLocaleString() : row['Sum']}</td> : null}
                          <td style={{textAlign:'right'}}>{typeof row['Count'] === 'number' ? row['Count'].toLocaleString() : row['Count']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    setFatalError(err);
    return (
      <div style={{background:'#f00',color:'#fff',padding:'2rem',fontWeight:'bold'}}>FATAL ERROR: {err.toString()}</div>
    );
  }
}

export default App;
