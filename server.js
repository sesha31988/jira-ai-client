
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

/* ============================
   GROQ CONFIG (OpenAI format)
============================ */

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

/* ============================
   CONFLUENCE KB MAPPING
============================ */

function getConfluenceLink(summary, description) {
  const text = (summary + " " + description).toLowerCase().replace(/[\W_]+/g, " "); // replace punctuation/underscores with space
  console.log("Combined text for KB lookup:", text);

  if (/password\s*reset/.test(text)) {
    return {
      title: "Password Reset Failure Guide",
      url: "https://sesha3-cxone-prod.atlassian.net/wiki/spaces/~7120200716321e790240d4b41e5f881fde3e4d/pages/851969/Password+Reset+Failure+Guide"
    };
  }

  if (/session\s*expired/.test(text)) {
    return {
      title: "Session Expired Troubleshooting",
      url: "https://sesha3-cxone-prod.atlassian.net/wiki/spaces/~7120200716321e790240d4b41e5f881fde3e4d/pages/917505/Session+Expired+Troubleshooting"
    };
  }

    if (/account\s*locked/.test(text)) {
    return {
      title: "Account Locked Resolution Steps",
      url: "https://sesha3-cxone-prod.atlassian.net/wiki/spaces/~7120200716321e790240d4b41e5f881fde3e4d/pages/917512/Account+Locked+Resolution+Steps"
    };
  }

  if (/sso/.test(text)) {
    return {
      title: "SSO Login Troubleshooting",
      url: "https://sesha3-cxone-prod.atlassian.net/wiki/spaces/~7120200716321e790240d4b41e5f881fde3e4d/pages/983041/SSO+Login+Troubleshooting"
    };
  }

  iif (/mfa|otp/.test(text)) {
    return {
      title: "Multi-Factor Authentication Issues",
      url: "https://sesha3-cxone-prod.atlassian.net/wiki/spaces/~7120200716321e790240d4b41e5f881fde3e4d/pages/1081345/Multi-Factor+Authentication+Issues"
    };
  }

  return null;
}

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

    const completion = await openai.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content;
}

/* ============================
   JIRA WEBHOOK ENDPOINT
============================ */

app.post("/jira-webhook", async (req, res) => {
  try {
    console.log("Webhook received");

    const issueKey = req.body?.issue?.key;
    const summary = req.body?.issue?.fields?.summary || "";
    const description = req.body?.issue?.fields?.description || "";

    if (!issueKey) {
      console.log("No issue key found");
      return res.status(200).send("No issue data");
    }

    console.log("Issue Key:", issueKey);
    console.log("Summary:", summary);

    /* ============================
       CALL GROQ AI
    ============================ */

    const completion = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
         {
          role: "system",
          content:
            "You are an IT support assistant. Analyze login/password issues and provide troubleshooting steps, severity suggestion, and next action."
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
    
    /* ============================
       GET CONFLUENCE KB LINK
    ============================ */

    const kbPage = getConfluenceLink(summary, description);
    console.log("KB link found:", kbPage);

    let finalComment = ` AI Analysis:\n\n${aiResponse}`;

    if (kbPage) {
      finalComment += `\n\n Recommended Knowledge Article:\n${kbPage.title}\n${kbPage.url}`;
    }

    /* ============================
       POST COMMENT TO JIRA (v3 ADF)
    ============================ */

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
                  text: ` AI Analysis:\n\n${aiResponse}`
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
    console.error("Error:", error.response?.data || error.message);
    res.status(500).send("Error occurred");
  }
});

/* ============================
   START SERVER
============================ */

const PORT = process.env.PORT || 1000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
