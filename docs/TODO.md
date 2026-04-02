# To do file

I will be listing the things which needs to be implemented in the future. Coding agents like claude, cursor, gpt should ignore this file unless mentioned explicitly. 

- Rate limiting a user 
- Build the application for anthropic rate limits 
- Handling concurrency across multiple mcp servers 
- Include only research papers and not review papers. 
- Look into openevidence platform

Create codemaps
Create visual architectural diagram from developer perspective
Create a help page for bio researchers to understand the systems capabilities in their language

Analyze the two tier system for reducing large tool output. Figure out if we can preserve json format and prevent truncation at tier 2. 
Remove the legacy chat.ts 
Analyze the platforms tool calls and compare if they give you the same information. For example a open targets tool might give protein interaction data which makes uniprot tool call as duplicate info. 

Analyze uniprot, chembl and any platform which returns large tool output to refine global and platform centric noise filters and tool level policies
Logo design
Deployment on public infra
Users can dynamically select the platforms. Then the agent will only use those platforms and nothing else. 
For research papers add hyperlink
Building a testing framework
Implement rate limiting per user. Add transparency around rate limits so that users use it wisely. 
