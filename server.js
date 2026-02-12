
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

const jiraAuth = {
  username: process.env.JIRA_EMAIL,
  password: process.env.JIRA_API_TOKEN,
};

const jiraApi = axios.create({
  baseURL: process.env.JIRA_BASE_URL,
  auth: jiraAuth,
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json",
  },
});

async function searchSimilarIssues(query, project) {
  const jql = `project=${project} AND text ~ "${query}" ORDER BY created DESC`;
  const response = await jiraApi.post("/rest/api/3/search", {
    jql,
    maxResults: 3,
  });
  return response.data.issues;
}

async function addComment(issueKey, comment) {
  await jiraApi.post(`/rest/api/3/issue/${issueKey}/comment`, {
    body: comment,
  });
}

async function analyzeTicket(summary, description) {
  const prompt = `
You are a support assistant.
Analyze this Jira ticket and suggest possible investigation direction.

Title: ${summary}
Description: ${description}

Return a short analysis.
`;

  // const completion = await openai.chat.completions.create({
  //   model: "gpt-4o-mini",
  //   messages: [{ role: "user", content: prompt }],
  // });

    const completion = await openai.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content;
}

app.post("/jira-webhook", async (req, res) => {
  try {
    console.log("Webhook received");

    const issueKey = req.body?.issue?.key;
    const summary = req.body?.issue?.fields?.summary;
    const description = req.body?.issue?.fields?.description;

    if (!issueKey) {
      console.log("No issue key found");
      return res.status(200).send("No issue data");
    }

    console.log("Issue Key:", issueKey);
    console.log("Summary:", summary);

    // Call Groq
    const completion = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are an IT incident analysis assistant."
        },
        {
          role: "user",
          content: `Issue Summary: ${summary}\nDescription: ${description}`
        }
      ]
    });

    const aiResponse = completion.choices[0].message.content;

    console.log("AI Response generated");

    console.log("Posting to:", `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/comment`);

    // Post comment back to Jira
    await axios.post(
      `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/comment`,
      {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `🤖 AI Analysis:\n\n${aiResponse}`
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
            ).toString("base64"),
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Comment added successfully.");

    res.status(200).send("Success");
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("Error occurred");
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
