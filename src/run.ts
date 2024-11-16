import dotenv from 'dotenv';
// Load environment variables at the very beginning
dotenv.config();

import { runAloria, configureAloria } from 'aloria';
import { chromium } from 'playwright';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { simpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';

async function generateReadme(repoUrl: string): Promise<{
  readme: string;
  detailedDescription: string;
}> {
  // Initialize clients
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Clone the repository
  const tempDir = await cloneRepository(repoUrl);

  // Generate code summaries
  const codeSummary = readDirectory(tempDir);

  // Clean up the cloned repository
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Generate README and detailed description using OpenAI
  const readme = await createReadme(openai, codeSummary);
  const detailedDescription = await createDetailedDescription(
    openai,
    codeSummary
  );

  return {
    readme: readme.trim(),
    detailedDescription: detailedDescription.trim(),
  };
}

// Helper function to clone the repository
async function cloneRepository(repoUrl: string): Promise<string> {
  const tempDir = path.join(__dirname, 'temp_repo');
  const git = simpleGit();
  try {
    await git.clone(repoUrl, tempDir);
    return tempDir;
  } catch (error) {
    console.error('Error cloning repository:', error);
    throw error;
  }
}

// Helper function to read directory and summarize files
function readDirectory(dir: string): string {
  let content = '';
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.lstatSync(filePath);
    if (stat.isDirectory()) {
      content += readDirectory(filePath);
    } else if (
      file.endsWith('.js') ||
      file.endsWith('.ts') ||
      file.endsWith('.py') ||
      file.endsWith('.java') ||
      file.endsWith('.md')
    ) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const fileSummary = summarizeFile(fileContent, file);
        content += `\n\n---\n**File:** ${filePath.replace(
          dir,
          ''
        )}\n${fileSummary}\n`;
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        continue;
      }
    }
  }
  return content;
}

// Helper function to summarize individual files
function summarizeFile(content: string, filename: string): string {
  let summary = '';

  if (filename.endsWith('.js') || filename.endsWith('.ts')) {
    // Parse JavaScript/TypeScript files
    try {
      const ast = parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      const imports: string[] = [];
      const exports: string[] = [];
      const classes: string[] = [];
      const functions: string[] = [];

      ast.program.body.forEach((node) => {
        switch (node.type) {
          case 'ImportDeclaration':
            imports.push(node.source.value);
            break;
          case 'ExportNamedDeclaration':
          case 'ExportDefaultDeclaration':
            exports.push(node.type);
            break;
          case 'ClassDeclaration':
            if (node.id) {
              classes.push(node.id.name);
            }
            break;
          case 'FunctionDeclaration':
            if (node.id) {
              functions.push(node.id.name);
            }
            break;
        }
      });

      summary += `- **Imports:** ${imports.join(', ')}\n`;
      summary += `- **Exports:** ${exports.join(', ')}\n`;
      summary += `- **Classes:** ${classes.join(', ')}\n`;
      summary += `- **Functions:** ${functions.join(', ')}\n`;
    } catch (error) {
      console.error(`Error parsing file ${filename}:`, error);
    }
  } else if (filename.endsWith('.py')) {
    // Implement similar logic for Python files (omitted for brevity)
  } else if (filename.endsWith('.md')) {
    // Include the first few lines of Markdown files
    const lines = content.split('\n').slice(0, 5).join('\n');
    summary += `- **Content Preview:**\n${lines}\n`;
  } else {
    summary += `- **Summary:** Not available for this file type.\n`;
  }

  return summary;
}

// Helper function to create README using OpenAI
async function createReadme(
  openai: OpenAI,
  codeSummary: string
): Promise<string> {
  try {
    const readmeResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: "system",
          content: "You are an assistant that writes detailed README files for GitHub repositories based on their codebase summaries."
        },
        {
          role: 'user',
          content: `Based on the following codebase summary, generate a comprehensive README file for the repository:\n\n${codeSummary}`,
        },
      ],
    });

    return (
      readmeResponse.choices[0].message?.content || 'No README generated'
    );
  } catch (error) {
    console.error('Error generating README:', error);
    throw error;
  }
}

// Helper function to create detailed description using OpenAI
async function createDetailedDescription(
  openai: OpenAI,
  codeSummary: string
): Promise<string> {
  try {
    const descriptionResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that provides detailed descriptions of applications based on their codebase summaries.',
        },
        {
          role: 'user',
          content: `Based on the following codebase summary, provide a very detailed description of the full application:\n\n${codeSummary}`,
        },
      ],
    });

    return (
      descriptionResponse.choices[0].message?.content ||
      'No detailed description generated'
    );
  } catch (error) {
    console.error('Error generating detailed description:', error);
    throw error;
  }
}

// Helper function to create a concise prompt for image generation
function createImagePrompt(description: string): string {
  // Split into sentences and take first few
  const sentences = description.split(/[.!?]+/).filter(Boolean);
  const shortDescription = sentences.slice(0, 3).join('. ');
  
  // Create a focused prompt
  return `User interface screenshot of a web application: ${shortDescription.slice(0, 950)}`.trim();
}

async function generateImages(openai: OpenAI, description: string): Promise<string[]> {
  const imageUrls: string[] = [];
  try {
    const imagePrompt = createImagePrompt(description);
    console.log('Using image generation prompt:', imagePrompt);
    
    const imagesResponse = await openai.images.generate({
      prompt: imagePrompt,
      n: 4,
      size: '1024x1024',
    });
    return imagesResponse.data.map((image: any) => image.url);
  } catch (error) {
    console.error('Error generating images:', error);
    return imageUrls;
  }
}

async function main() {
  // Configure Aloria with environment variable
  configureAloria({
    apiKey: process.env.ALORIA_API_KEY,
  });

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Get the base URL from command-line arguments
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Please provide a base URL as a command-line argument.');
    process.exit(1);
  }

  // Combine the base URL with the specific path
  const fullUrl = `${baseUrl}/events/bangkok/project`;
  await page.goto(fullUrl);

  const { readme, detailedDescription } = await generateReadme(
    'https://github.com/henrikkv/hackathon-submit'
  );

  console.log('Generated README:\n');
  console.log(readme);
  console.log('\nDetailed Description:\n');
  console.log(detailedDescription);

  // Generate images
  const imageUrls = await generateImages(openai, detailedDescription);
  console.log('Generated Image URLs:');
  console.log(imageUrls);
  

  const result = await runAloria({
    page,
    task: `If the project has not been created yet, fill the "Project name", "What category does your project belong to?", and "What emoji best represents your project?" fields with something. Then click the checkmark, and Create Project button.`,
    /*resultSchema: z.object({
      author: z.string(),
      text: z.string(),
      when: z.string(),
    }),*/
  });
  console.log(result);

  // Open Playwright debugger
  await page.pause();

  await browser.close();
}

void main();

