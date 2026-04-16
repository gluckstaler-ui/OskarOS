/**
 * Creative Director Agent
 *
 * Dual-mode agent for brand inference and discovery:
 *
 * Mode 1: INFERENCE ENGINE (Pre-Preview)
 * - Runs immediately on first message
 * - NEVER asks questions
 * - Outputs Minimum Viable Creative Brief (MVCB)
 *
 * Mode 2: DISCOVERY CONVERSATION (Post-Preview)
 * - Runs after preview is visible
 * - Weaves questions naturally into refinement conversation
 * - Progressively enhances the brand brief
 *
 * @module shared/onboarding2/lib/CreativeDirectorAgent
 */

import type {
  UserType,
  CDMode,
  MinimumViableCreativeBrief,
  WebsiteScrapedData,
  ArchetypeId,
  BrandTone,
} from '../types/onboarding2';
import {
  getCategoryDefaults,
  buildMVCBFromDefaults,
  inferArchetypeFromKeywords,
} from './categoryDefaults';
import { scrapeWebsite } from './WebsiteScraperAgent';

// =============================================================================
// TYPES
// =============================================================================

export interface InferenceInputs {
  firstMessage: string;
  userType: UserType;
  cdMode: CDMode;
  detectedUrl?: string;
  detectedBusinessName?: string;
}

export interface InferenceResult {
  brief: MinimumViableCreativeBrief;
  scrapedData?: WebsiteScrapedData;
  inferredArchetype: ArchetypeId;
}

// =============================================================================
// BRAND NAME EXTRACTION
// =============================================================================

/**
 * Extract business name from user input using various patterns
 */
function extractBusinessName(input: string): string | undefined {
  // Pattern: "called X" or "named X"
  const calledMatch = input.match(/\b(?:called|named)\s+["']?([^"'\n,]+?)["']?(?:\s|,|$)/i);
  if (calledMatch?.[1]) {
    return calledMatch[1].trim();
  }

  // Pattern: "X studio/salon/clinic/etc"
  const businessTypeMatch = input.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(studio|salon|clinic|spa|gym|restaurant|cafe|shop|boutique|bar)\b/i);
  if (businessTypeMatch?.[1]) {
    return `${businessTypeMatch[1]} ${businessTypeMatch[2]}`;
  }

  // Pattern: "my studio X" or "our X studio"
  const possessiveMatch = input.match(/\b(?:my|our)\s+(?:business|company)?\s*(?:is\s+)?["']?([A-Z][a-zA-Z\s]+?)["']?(?:\s|,|$)/i);
  if (possessiveMatch?.[1]) {
    return possessiveMatch[1].trim();
  }

  // Pattern: quoted name
  const quotedMatch = input.match(/["']([^"']+)["']/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  return undefined;
}

/**
 * Extract location/country from user input
 */
function extractLocation(input: string): string | undefined {
  // Common cities and countries
  const locations = [
    'Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Stuttgart',
    'Vienna', 'Zurich', 'Geneva', 'Basel',
    'London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow',
    'New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Miami', 'Austin',
    'Paris', 'Lyon', 'Marseille', 'Amsterdam', 'Barcelona', 'Madrid', 'Rome', 'Milan',
    'Germany', 'Austria', 'Switzerland', 'UK', 'USA', 'France', 'Netherlands', 'Spain', 'Italy',
  ];

  const inputLower = input.toLowerCase();
  for (const location of locations) {
    if (inputLower.includes(location.toLowerCase())) {
      return location;
    }
  }

  // Pattern: "in X" or "from X"
  const inMatch = input.match(/\b(?:in|from|based\s+in|located\s+in)\s+([A-Z][a-zA-Z\s]+?)(?:\s|,|$)/i);
  if (inMatch?.[1]) {
    return inMatch[1].trim();
  }

  return undefined;
}

/**
 * Extract differentiator from user input
 */
function extractDifferentiator(input: string): string | undefined {
  // Pattern: "specializ(e/ing) in X"
  const specializeMatch = input.match(/\bspeciali[zs](?:e|ing)\s+in\s+([^,.]+)/i);
  if (specializeMatch?.[1]) {
    return specializeMatch[1].trim();
  }

  // Pattern: "focus on X"
  const focusMatch = input.match(/\bfocus(?:ed|ing)?\s+on\s+([^,.]+)/i);
  if (focusMatch?.[1]) {
    return focusMatch[1].trim();
  }

  // Pattern: "known for X"
  const knownMatch = input.match(/\bknown\s+for\s+([^,.]+)/i);
  if (knownMatch?.[1]) {
    return knownMatch[1].trim();
  }

  // Pattern: "unique X" or "different X"
  const uniqueMatch = input.match(/\b(?:unique|different|special)(?:\s+\w+)?\s+([^,.]+)/i);
  if (uniqueMatch?.[1]) {
    return uniqueMatch[1].trim();
  }

  return undefined;
}

// =============================================================================
// TONE INFERENCE
// =============================================================================

/**
 * Infer brand tone from user input and archetype
 */
function inferTone(input: string, archetype: ArchetypeId): BrandTone {
  const inputLower = input.toLowerCase();

  // Keyword-based tone detection
  if (/luxury|premium|exclusive|high-end|elegant|boutique/.test(inputLower)) {
    return 'luxurious';
  }
  if (/friendly|welcoming|warm|cozy|comfortable|relaxed/.test(inputLower)) {
    return 'friendly';
  }
  if (/professional|corporate|business|executive|formal/.test(inputLower)) {
    return 'professional';
  }
  if (/fun|playful|energetic|vibrant|exciting|dynamic/.test(inputLower)) {
    return 'energetic';
  }
  if (/calm|peaceful|serene|relaxing|zen|mindful/.test(inputLower)) {
    return 'calm';
  }
  if (/modern|minimal|sleek|clean|simple/.test(inputLower)) {
    return 'minimal';
  }
  if (/bold|strong|confident|powerful/.test(inputLower)) {
    return 'confident';
  }

  // Fall back to archetype defaults
  const defaults = getCategoryDefaults(archetype);
  return defaults.tone;
}

// =============================================================================
// HEADLINE GENERATION
// =============================================================================

/**
 * Generate contextual hero headline
 */
function generateHeadline(
  archetype: ArchetypeId,
  businessName: string,
  differentiator?: string
): string {
  // If we have a differentiator, try to incorporate it
  if (differentiator) {
    // Short differentiators can be used directly
    if (differentiator.split(' ').length <= 4) {
      return `${differentiator.charAt(0).toUpperCase() + differentiator.slice(1)} at ${businessName}`;
    }
  }

  // Use category defaults
  const defaults = getCategoryDefaults(archetype);
  return defaults.heroHeadline;
}

/**
 * Generate CTA text based on archetype
 */
function generateCtaText(archetype: ArchetypeId): string {
  const defaults = getCategoryDefaults(archetype);
  return defaults.ctaText;
}

// =============================================================================
// MODE 1: INFERENCE ENGINE
// =============================================================================

/**
 * Run inference engine to generate Minimum Viable Creative Brief
 * This is Mode 1 - runs BEFORE preview, NEVER asks questions
 */
export async function runInferenceEngine(
  inputs: InferenceInputs
): Promise<InferenceResult> {
  const { firstMessage, cdMode, detectedUrl, detectedBusinessName } = inputs;

  // Infer archetype from keywords
  const inferredArchetype = inferArchetypeFromKeywords(firstMessage);

  // Start with category defaults
  let brief = buildMVCBFromDefaults(inferredArchetype, detectedBusinessName ?? 'Your Business');

  // Track inference sources
  const inferenceSources: string[] = ['category_defaults'];

  // Extract additional info from the message
  const extractedName = detectedBusinessName ?? extractBusinessName(firstMessage);
  const extractedLocation = extractLocation(firstMessage);
  const extractedDifferentiator = extractDifferentiator(firstMessage);

  if (extractedName) {
    brief.businessName = extractedName;
    inferenceSources.push('extracted_name');
  }

  // Track discovery gaps
  const discoveryGaps: string[] = [];
  if (!extractedName || extractedName === 'Your Business') {
    discoveryGaps.push('business_name');
  }
  if (!extractedLocation) {
    discoveryGaps.push('location');
  }
  if (!extractedDifferentiator) {
    discoveryGaps.push('differentiator');
  }
  // Always add these as they provide deeper brand understanding
  discoveryGaps.push('ideal_customer', 'brand_feeling', 'story');

  // Handle different CD modes
  let scrapedData: WebsiteScrapedData | undefined;

  switch (cdMode) {
    case 'MATCH':
      // Type C: Scrape website and match brand
      if (detectedUrl) {
        try {
          scrapedData = await scrapeWebsite(detectedUrl);
          brief = matchBrandFromScrapedData(scrapedData, brief);
          inferenceSources.push('website_scrape');
        } catch {
          // Scraping failed, continue with defaults
          console.warn('[CD Agent] Website scraping failed, using defaults');
        }
      }
      break;

    case 'EXTRACT':
      // Type A: Extract from description, be conservative
      brief.tone = inferTone(firstMessage, inferredArchetype);
      brief.heroHeadline = generateHeadline(inferredArchetype, brief.businessName, extractedDifferentiator);
      brief.ctaText = generateCtaText(inferredArchetype);
      inferenceSources.push('user_input_extraction');
      break;

    case 'CREATE':
      // Type B: Help create brand, be more opinionated
      brief.tone = inferTone(firstMessage, inferredArchetype);
      brief.heroHeadline = generateHeadline(inferredArchetype, brief.businessName, extractedDifferentiator);
      brief.ctaText = generateCtaText(inferredArchetype);
      // For new ventures, push for name discovery first
      if (!extractedName && !discoveryGaps.includes('business_name')) {
        discoveryGaps.unshift('business_name');
      }
      inferenceSources.push('new_venture_creation');
      break;

    case 'DEVELOP':
      // Type D: Full creative development
      brief.tone = inferTone(firstMessage, inferredArchetype);
      brief.heroHeadline = generateHeadline(inferredArchetype, brief.businessName, extractedDifferentiator);
      brief.ctaText = generateCtaText(inferredArchetype);
      inferenceSources.push('full_development');
      break;

    default:
      // Default behavior - same as EXTRACT
      brief.tone = inferTone(firstMessage, inferredArchetype);
      brief.heroHeadline = generateHeadline(inferredArchetype, brief.businessName, extractedDifferentiator);
      brief.ctaText = generateCtaText(inferredArchetype);
      inferenceSources.push('default_inference');
      break;
  }

  // Calculate confidence score
  let confidenceScore = 0.3; // Base confidence
  if (extractedName && extractedName !== 'Your Business') {
    confidenceScore += 0.2;
  }
  if (extractedLocation) {
    confidenceScore += 0.1;
  }
  if (extractedDifferentiator) {
    confidenceScore += 0.1;
  }
  if (scrapedData) {
    confidenceScore += 0.2;
  }

  // Update brief with final values
  brief.confidenceScore = Math.min(confidenceScore, 0.9);
  brief.inferenceSources = inferenceSources;
  brief.discoveryGaps = discoveryGaps;

  return {
    brief,
    scrapedData,
    inferredArchetype,
  };
}

/**
 * Match brand from scraped website data
 */
function matchBrandFromScrapedData(
  scrapedData: WebsiteScrapedData,
  baseBrief: MinimumViableCreativeBrief
): MinimumViableCreativeBrief {
  return {
    ...baseBrief,
    businessName: scrapedData.businessName || baseBrief.businessName,
    primaryColor: scrapedData.detectedColors.primary,
    secondaryColor: scrapedData.detectedColors.secondary,
    fontFamily: scrapedData.detectedFonts.headings,
    tagline: scrapedData.tagline,
    // Map scraped tone to our BrandTone type
    tone: mapScrapedToneToBrandTone(scrapedData.inferredTone),
    confidenceScore: 0.8, // High confidence from scraping
  };
}

/**
 * Map scraped tone string to BrandTone type
 */
function mapScrapedToneToBrandTone(scrapedTone: string): BrandTone {
  const toneMap: Record<string, BrandTone> = {
    professional: 'professional',
    friendly: 'friendly',
    modern: 'minimal',
    elegant: 'luxurious',
    playful: 'energetic',
    minimal: 'minimal',
    bold: 'confident',
    warm: 'welcoming',
  };

  return toneMap[scrapedTone.toLowerCase()] ?? 'professional';
}

// =============================================================================
// BRIEF UPDATE HELPERS
// =============================================================================

/**
 * Update creative brief with a discovery answer
 */
export function updateBriefWithAnswer(
  brief: MinimumViableCreativeBrief,
  questionId: string,
  answer: string
): MinimumViableCreativeBrief {
  const updatedBrief = { ...brief };

  switch (questionId) {
    case 'business_name':
      updatedBrief.businessName = answer;
      break;

    case 'differentiator':
      // Incorporate into tagline if not set
      if (!updatedBrief.tagline) {
        updatedBrief.tagline = answer;
      }
      break;

    case 'ideal_customer':
      // Adjust tone based on customer description
      if (/professional|business|corporate/.test(answer.toLowerCase())) {
        updatedBrief.tone = 'professional';
      } else if (/young|fun|active|energetic/.test(answer.toLowerCase())) {
        updatedBrief.tone = 'energetic';
      } else if (/luxury|premium|high-end/.test(answer.toLowerCase())) {
        updatedBrief.tone = 'luxurious';
      }
      break;

    case 'brand_feeling':
      // Map feeling to tone
      const feelingToneMap: Record<string, BrandTone> = {
        calm: 'calm',
        relaxed: 'calm',
        peaceful: 'calm',
        energetic: 'energetic',
        excited: 'energetic',
        confident: 'confident',
        professional: 'professional',
        welcomed: 'welcoming',
        special: 'luxurious',
      };
      for (const [feeling, tone] of Object.entries(feelingToneMap)) {
        if (answer.toLowerCase().includes(feeling)) {
          updatedBrief.tone = tone;
          break;
        }
      }
      break;

    case 'brand_colors':
      // User specified colors they love/hate
      // This would need more sophisticated handling
      break;

    case 'communication_style':
      if (/formal|professional/.test(answer.toLowerCase())) {
        updatedBrief.tone = 'professional';
      } else if (/casual|informal|friendly/.test(answer.toLowerCase())) {
        updatedBrief.tone = 'friendly';
      }
      break;

    default:
      // Unknown question - no specific update
      break;
  }

  // Remove answered question from gaps
  updatedBrief.discoveryGaps = updatedBrief.discoveryGaps.filter(gap => gap !== questionId);

  // Increase confidence
  updatedBrief.confidenceScore = Math.min(updatedBrief.confidenceScore + 0.05, 0.95);

  // Add source
  if (!updatedBrief.inferenceSources.includes('discovery_answers')) {
    updatedBrief.inferenceSources.push('discovery_answers');
  }

  return updatedBrief;
}

// =============================================================================
// MODE 2: DISCOVERY CONVERSATION (Post-Preview)
// =============================================================================

/**
 * Deep brand questions organized by tier
 * These provide rich brand understanding beyond the basic questions
 */
export const DEEP_BRAND_QUESTIONS = {
  essential: [
    {
      id: 'brand_personality',
      question: 'If your brand was a person, how would you describe their personality?',
      hookContexts: ['positive_feedback', 'style_change'],
      impact: 'Refines voice and messaging across all copy',
    },
    {
      id: 'customer_transformation',
      question: 'What transformation do customers experience after working with you?',
      hookContexts: ['service_edit', 'testimonial_discussion'],
      impact: 'Creates compelling value proposition',
    },
    {
      id: 'first_impression',
      question: 'What do you want the first thing people notice about your brand to be?',
      hookContexts: ['hero_edit', 'color_change'],
      impact: 'Optimizes hero section and visual hierarchy',
    },
  ],
  enhanced: [
    {
      id: 'brand_values',
      question: 'What are the 3 core values your business stands for?',
      hookContexts: ['about_edit', 'deep_engagement'],
      impact: 'Creates authentic about section and team bios',
    },
    {
      id: 'origin_story',
      question: 'What moment or experience inspired you to start this business?',
      hookContexts: ['about_section_view', 'positive_feedback'],
      impact: 'Generates compelling brand story',
    },
    {
      id: 'customer_words',
      question: 'What words do your happiest customers use to describe you?',
      hookContexts: ['testimonial_discussion', 'positive_feedback'],
      impact: 'Aligns copy with customer language',
    },
    {
      id: 'avoid_perception',
      question: "What's something you NEVER want customers to think about your brand?",
      hookContexts: ['copy_edit', 'style_change'],
      impact: 'Refines messaging to avoid wrong impressions',
    },
    {
      id: 'booking_hesitation',
      question: 'What makes people hesitate before booking with you?',
      hookContexts: ['faq_edit', 'service_edit'],
      impact: 'Addresses objections in FAQ and copy',
    },
  ],
  premium: [
    {
      id: 'five_year_vision',
      question: 'Where do you see your business in 5 years?',
      hookContexts: ['deep_engagement', 'launch_discussion'],
      impact: 'Future-proofs brand positioning',
    },
    {
      id: 'brand_voice_sample',
      question: 'Write a sentence the way YOU would explain your business to a friend.',
      hookContexts: ['copy_edit', 'voice_discussion'],
      impact: 'Captures authentic voice for all copy',
    },
    {
      id: 'dream_review',
      question: 'What would your dream customer review say?',
      hookContexts: ['testimonial_discussion', 'positive_feedback'],
      impact: 'Generates aspirational copy',
    },
    {
      id: 'secret_sauce',
      question: 'What do you do that competitors simply can\'t copy?',
      hookContexts: ['differentiator_edit', 'deep_engagement'],
      impact: 'Strengthens competitive positioning',
    },
    {
      id: 'brand_feeling_detail',
      question: 'Describe the ideal emotional journey from landing on your page to completing a booking.',
      hookContexts: ['user_experience', 'launch_discussion'],
      impact: 'Optimizes entire user flow',
    },
  ],
};

/**
 * Get the next discovery question based on context and progress
 */
export function getNextDeepQuestion(
  answeredQuestionIds: string[],
  context: string,
  tier: 'essential' | 'enhanced' | 'premium' = 'essential'
): { id: string; question: string; impact: string } | null {
  const answeredSet = new Set(answeredQuestionIds);

  // Get questions for the current tier and below
  const tiers: ('essential' | 'enhanced' | 'premium')[] = ['essential', 'enhanced', 'premium'];
  const tierIndex = tiers.indexOf(tier);
  const availableTiers = tiers.slice(0, tierIndex + 1);

  // Collect all questions from available tiers
  const allQuestions = availableTiers.flatMap(
    (t) => DEEP_BRAND_QUESTIONS[t].map((q) => ({ ...q, tier: t }))
  );

  // Filter to unanswered questions
  const unanswered = allQuestions.filter((q) => !answeredSet.has(q.id));

  if (unanswered.length === 0) {
    return null;
  }

  // First, try to find a question that matches the current context
  const contextMatch = unanswered.find((q) => q.hookContexts.includes(context));
  if (contextMatch) {
    return {
      id: contextMatch.id,
      question: contextMatch.question,
      impact: contextMatch.impact,
    };
  }

  // Otherwise, return the first unanswered question (prioritizes earlier tiers)
  const first = unanswered[0];
  if (first) {
    return {
      id: first.id,
      question: first.question,
      impact: first.impact,
    };
  }

  return null;
}

/**
 * Generate a natural way to weave a question into conversation
 */
export function weaveQuestionNaturally(
  question: string,
  previousResponse: string
): string {
  // Transition phrases based on context
  const transitions = [
    'By the way, ',
    "That reminds me - ",
    "One thing that would help me refine this further: ",
    "Quick question while I'm thinking about it: ",
    "To make this even better, ",
    "Oh, and I'm curious - ",
  ];

  // Pick a random transition
  const transition = transitions[Math.floor(Math.random() * transitions.length)];

  return `${previousResponse}\n\n${transition}${question}`;
}

/**
 * Determine if we should ask a discovery question
 * Returns true if:
 * - User gave positive feedback
 * - Conversation has natural opening
 * - Not too many questions asked recently
 */
export function shouldAskDiscoveryQuestion(
  messageHistory: { role: 'user' | 'assistant'; content: string }[],
  questionsAskedInSession: number
): boolean {
  // Don't ask more than 3 questions per session
  if (questionsAskedInSession >= 3) {
    return false;
  }

  // Don't ask on every message - roughly every 2-3 exchanges
  if (messageHistory.length < 3) {
    return false;
  }

  // Check if user's last message was positive
  const lastUserMessage = messageHistory
    .filter((m) => m.role === 'user')
    .pop();

  if (!lastUserMessage) {
    return false;
  }

  const positiveIndicators = [
    'looks good',
    'love it',
    'great',
    'perfect',
    'awesome',
    'nice',
    'thanks',
    'cool',
    ':)',
    '👍',
    '🎉',
  ];

  const messageText = lastUserMessage.content.toLowerCase();
  const isPositive = positiveIndicators.some((indicator) =>
    messageText.includes(indicator)
  );

  // 50% chance when positive, 20% chance otherwise
  const probability = isPositive ? 0.5 : 0.2;
  return Math.random() < probability;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  extractBusinessName,
  extractLocation,
  extractDifferentiator,
  inferTone,
  generateHeadline,
  generateCtaText,
};
