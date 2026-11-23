import { Registry } from "../integrations/registry";
import { gcalendar, gmail } from "./google";
import { github } from "./github";
import { linear } from "./linear";
import { slack } from "./slack";

export const defaultRegistry = () => new Registry([gmail, gcalendar, slack, github, linear]);
