import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Progress, Radio, Select, Tag } from 'antd';
import { FolderOpen } from 'lucide-react';
import type { State } from '../shared/contracts';
import { LOCAL_MODELS, LOCAL_MODEL_URL } from '../shared/local-models';
import type { RunCommand } from './bridge';
import { Field } from './primitives';

type Provider='codex'|'api'|'local';
export function Settings({ state, run, busy, close }: { readonly state: State; readonly run: RunCommand; readonly busy: boolean; readonly close: () => void }) {
  const [baseUrl, setBaseUrl] = useState(state.settings.aiBaseUrl);
  const [model, setModel] = useState(state.settings.aiModel);
  const [key, setKey] = useState('');
  const [localModel, setLocalModel] = useState(LOCAL_MODELS.find(item=>item.id===state.settings.aiModel)?.id ?? 'qwen2.5:3b');
  const [provider, setProvider] = useState<Provider>(state.settings.aiProvider ?? (state.settings.aiModel.trim() ? 'api' : 'codex'));
  const [jobId, setJobId] = useState('');
  const [question, setQuestion] = useState('请问公司的办公地址和这个岗位的工作时间是什么？');
  const config={aiProvider:provider,aiBaseUrl:provider==='local'?LOCAL_MODEL_URL:baseUrl.trim(),aiModel:provider==='local'?localModel:model.trim(),apiKey:provider==='api'?key:''};
  const result=state.modelTest;
  const resultHeading=useRef<HTMLHeadingElement>(null);
  const lastResult=useRef(result.at);
  useEffect(()=>{
    if((result.status==='passed'||result.status==='failed')&&result.at!==lastResult.current){
      lastResult.current=result.at;resultHeading.current?.scrollIntoView({block:'start'});resultHeading.current?.focus({preventScroll:true});
    }
  },[result.at,result.status]);
  const installing=state.localModel.phase==='installing';
  return <Modal title="应用设置 · 大模型配置" width={720} open onCancel={close} okText="保存配置" cancelText="关闭" confirmLoading={busy} okButtonProps={{disabled:busy||installing}} onOk={() => { void run({ type: 'saveSettings', value: { chromePath: state.settings.chromePath, ...config } }).then(ok => { if (ok) close(); }); }}><div className="stack">
    <Field label="登录浏览器" htmlFor="chrome-path" help="连接账号时打开 Chrome，完成后自动关闭。"><div className="cluster"><Input id="chrome-path" value={state.settings.chromePath || '自动检测本机 Chrome'} readOnly /><Button icon={<FolderOpen size={16} />} disabled={busy} onClick={() => void run({ type: 'chooseChrome' })}>选择 Chrome</Button></div></Field>
    <div className="dialog-divider" /><h3>选择模型来源</h3>
    <Radio.Group aria-label="模型来源" value={provider} disabled={busy||installing} onChange={event => { const value:unknown=event.target.value;if(value==='api'||value==='local'||value==='codex')setProvider(value); }}><Radio value="api">在线模型</Radio><Radio value="local">本地模型</Radio><Radio value="codex">本机 Codex</Radio></Radio.Group>
    {provider==='codex' && <Alert type="info" showIcon message="使用已登录的本机 Codex" description="无需 API 密钥。生成时会将选中的资料发送给 Codex 服务。" />}
    {provider==='api' && <>
      <p className="muted">支持兼容 OpenAI Chat Completions 的在线服务。生成时发送当前会话、岗位规则和命中的知识片段。</p>
      <Field label="服务地址" htmlFor="ai-url" help="填写基础地址（通常以 /v1 结尾），不要填写 /chat/completions。"><Input id="ai-url" value={baseUrl} disabled={busy} onChange={event=>setBaseUrl(event.target.value)} placeholder="https://服务域名/v1" /></Field>
      <Field label="模型名称" htmlFor="ai-model"><Input id="ai-model" value={model} disabled={busy} onChange={event=>setModel(event.target.value)} placeholder="填写服务支持的模型 ID" /></Field>
      <Field label="API 密钥" htmlFor="ai-key" help="同一服务留空保留已保存密钥；更换服务域名需重新填写。"><Input.Password id="ai-key" value={key} disabled={busy} onChange={event=>setKey(event.target.value)} autoComplete="new-password" placeholder={state.settings.hasApiKey?'已安全保存，输入可替换':'输入 API 密钥'} /></Field>
    </>}
    {provider==='local' && <>
      <Alert type="info" showIcon message="一键安装 Ollama 和本地模型" description="首次需要联网下载，之后本地生成无需 API 密钥。运行环境保存在软件数据目录，仅监听本机；软件退出时停止。轻量模型适合连接测试，正式使用前请验证回复质量。" />
      <Field label="下载模型" htmlFor="local-model"><Select id="local-model" value={localModel} disabled={busy||installing} options={LOCAL_MODELS.map(item=>({value:item.id,label:item.label}))} onChange={value=>setLocalModel(value)} /></Field>
      <div className="cluster"><Button type="primary" disabled={busy||installing} onClick={()=>void run({type:'installLocalModel',model:localModel})}>{state.localModel.phase==='ready'?'安装或检查所选模型':'一键下载安装并配置'}</Button><Button disabled={busy||!installing} onClick={()=>void run({type:'cancelLocalModel'})}>取消下载</Button></div>
      <p role="status">{state.localModel.message}</p>
      {installing && <Progress percent={Math.floor(state.localModel.progress)} />}
      {state.localModel.phase==='error' && <Alert showIcon type="error" message="安装未完成，可检查网络和磁盘后重试" />}
      {state.localModel.phase==='ready' && <Tag color="green">已安装：{state.localModel.model}</Tag>}
    </>}
    <div className="dialog-divider" /><h3>模型与知识库测试</h3>
    <Field label="测试岗位" htmlFor="test-job" help="不选岗位仅测试模型；选中后使用该岗位规则、岗位知识及同账号公司知识。"><Select id="test-job" allowClear value={jobId||undefined} placeholder="仅测试模型连接" disabled={busy} options={state.jobs.map(job=>({value:job.id,label:`${job.title} · ${state.accounts.find(a=>a.id===job.accountId)?.name??''}`}))} onChange={value=>setJobId(value??'')} /></Field>
    <Field label="测试问题" htmlFor="model-question"><Input.TextArea id="model-question" rows={2} maxLength={2000} value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)} /></Field>
    <Button loading={busy && result.status==='running'} disabled={busy||installing||!question.trim()} onClick={()=>void run({type:'testModel',value:config,question:question.trim(),...(jobId?{jobId}:{})})}>测试当前配置（不发送消息）</Button>
    <small>测试不会保存表单修改；本地一键安装完成后会自动配置。首次加载本地模型可能需要几分钟。</small>
    {result.status!=='idle' && <section className="stack" aria-label="上次模型测试结果"><h3 ref={resultHeading} tabIndex={-1}>上次测试结果</h3><Alert type={result.status==='passed'?'success':result.status==='failed'?'error':'info'} showIcon message={result.message} />{result.answer && <p className="preserve-text">{result.answer}</p>}{result.status==='passed' && <><strong>本次检索资料 · {result.sources.length} 条</strong>{result.sources.length===0 && <small>没有命中知识片段。回答仍可能使用已配置的岗位规则，不能据此编造公司事实。</small>}{result.sources.map((source,index)=><article key={`${source.title}-${index}`}><Tag>{source.scope==='company'?'公司共享':'岗位专属'}</Tag><strong>{source.title}</strong><p className="preserve-text">{source.text}</p></article>)}</>}</section>}
  </div></Modal>;
}
