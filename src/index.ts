import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { init, registerAgent, listAgents, createTask, listTasks, claimTask, completeTask, handoff, addContact, listContacts, registerTool, listTools, listActivity } from "./store.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
const token = process.env.CONDUIT_TOKEN;
const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!token) return next();
  const header = req.header("authorization");
  if (header !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
  next();
};

app.get("/", (_req,res)=>res.json({ service:"Conduit", status:"online", mcp:"/mcp", health:"/health", ready:"/ready" }));
app.get("/health", (_req,res)=>res.json({status:"ok",service:"conduit"}));
app.get("/ready", (_req,res)=>res.json({status:"ready",service:"conduit"}));

function server(){
  const s=new McpServer({name:"Conduit",version:"0.1.0"});
  s.tool("agent_register","Register an agent with Conduit",{id:z.string(),name:z.string(),description:z.string().optional()},async({id,name,description})=>({content:[{type:"text",text:JSON.stringify(await registerAgent({id,name,description}))}]}));
  s.tool("agents_list","List registered agents",{},async()=>({content:[{type:"text",text:JSON.stringify(await listAgents())}]}));
  s.tool("task_create","Create a coordination task",{title:z.string(),description:z.string().optional(),createdBy:z.string()},async(input)=>({content:[{type:"text",text:JSON.stringify(await createTask(input))}]}));
  s.tool("task_list","List tasks, optionally filtered by status",{status:z.enum(["open","claimed","blocked","completed"]).optional()},async({status})=>({content:[{type:"text",text:JSON.stringify(await listTasks(status))}]}));
  s.tool("task_claim","Atomically claim an open task",{taskId:z.string(),agentId:z.string()},async({taskId,agentId})=>({content:[{type:"text",text:JSON.stringify(await claimTask(taskId,agentId))}]}));
  s.tool("task_complete","Complete a task claimed by the calling agent",{taskId:z.string(),agentId:z.string()},async({taskId,agentId})=>({content:[{type:"text",text:JSON.stringify(await completeTask(taskId,agentId))}]}));
  s.tool("task_handoff","Hand a task from one agent to another",{taskId:z.string(),fromAgent:z.string(),toAgent:z.string(),note:z.string().optional()},async(input)=>({content:[{type:"text",text:JSON.stringify(await handoff(input.taskId,input.fromAgent,input.toAgent,input.note))}]}));
  s.tool("contact_add","Store a shared contact/resource reference",{name:z.string(),value:z.string(),kind:z.string()},async({name,value,kind})=>({content:[{type:"text",text:JSON.stringify(await addContact(name,value,kind))}]}));
  s.tool("contacts_list","List shared contacts/resources",{},async()=>({content:[{type:"text",text:JSON.stringify(await listContacts())}]}));
  s.tool("tool_register","Register a shared tool or MCP endpoint",{name:z.string(),description:z.string(),endpoint:z.string().optional()},async({name,description,endpoint})=>({content:[{type:"text",text:JSON.stringify(await registerTool(name,description,endpoint))}]}));
  s.tool("tools_list","List shared tools and endpoints",{},async()=>({content:[{type:"text",text:JSON.stringify(await listTools())}]}));
  s.tool("activity_list","List recent Conduit activity",{limit:z.number().int().min(1).max(200).optional()},async({limit})=>({content:[{type:"text",text:JSON.stringify(await listActivity(limit))}]}));
  return s;
}

app.all("/mcp", auth, async (req,res)=>{
  const s=server();
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on("close",()=>transport.close());
  try { await s.connect(transport); await transport.handleRequest(req,res,req.body); } catch(e) { if(!res.headersSent) res.status(500).json({error:"mcp_request_failed"}); console.error(e); }
});

const port=Number(process.env.PORT||3000);
init().then(()=>app.listen(port,()=>console.log(`Conduit listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
