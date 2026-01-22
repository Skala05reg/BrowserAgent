import json
from playwright.async_api import Page
from typing import Dict, Any, Tuple

class DOMParser:
    def __init__(self, page: Page):
        self.page = page

    async def get_interactive_tree(self) -> str:
        """
        Injects JS to find interactive elements, assigns them data-agent-id,
        and returns a text representation of the tree.
        """
        # We inject a script that returns a simplified JSON tree
        # and attributes elements with 'data-agent-id'
        tree_json = await self.page.evaluate("""
            () => {
                let idCounter = 0;
                
                function isVisible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           style.opacity !== '0' &&
                           el.offsetWidth > 0 && 
                           el.offsetHeight > 0;
                }

                function getInteractiveType(el) {
                    const tag = el.tagName.toLowerCase();
                    const role = el.getAttribute('role');
                    const type = el.getAttribute('type');
                    
                    if (tag === 'a') return 'link';
                    if (tag === 'button') return 'button';
                    if (tag === 'input') {
                        if (['submit', 'button', 'reset'].includes(type)) return 'button';
                        if (['checkbox', 'radio'].includes(type)) return type;
                        return 'input';
                    }
                    if (tag === 'select') return 'select';
                    if (tag === 'textarea') return 'input';
                    if (el.isContentEditable) return 'input';
                    if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') return role;
                    return null;
                }

                function traverse(node, depth) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent.trim();
                        if (text.length > 0) return { type: 'text', content: text };
                        return null;
                    }

                    if (node.nodeType !== Node.ELEMENT_NODE) return null;
                    
                    const el = node;
                    if (!isVisible(el)) return null;

                    const children = [];
                    node.childNodes.forEach(child => {
                        const res = traverse(child, depth + 1);
                        if (res) children.push(res);
                    });

                    const interactiveType = getInteractiveType(el);
                    let info = null;

                    if (interactiveType) {
                        idCounter++;
                        el.setAttribute('data-agent-id', idCounter.toString());
                        
                        let name = el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || "";
                        name = name.trim().split('\\n')[0].substring(0, 50); // Truncate

                        info = {
                            type: 'interactive',
                            id: idCounter,
                            role: interactiveType,
                            name: name,
                            children: children
                        };
                    } else {
                        // If not interactive, we only return it if it has useful children
                        if (children.length > 0) {
                            // Helper to extract text from generic containers if they look like labels
                            const directText = Array.from(node.childNodes)
                                .filter(n => n.nodeType === Node.TEXT_NODE)
                                .map(n => n.textContent.trim())
                                .join(' ');
                                
                            info = {
                                type: 'container',
                                text: directText,
                                children: children
                            };
                        }
                    }
                    
                    return info;
                }

                return traverse(document.body, 0);
            }
        """)
        
        return self._format_tree(tree_json)

    def _format_tree(self, node: Dict[str, Any], depth: int = 0) -> str:
        if not node:
            return ""
            
        indent = "  " * depth
        lines = []
        
        if node.get('type') == 'interactive':
            lines.append(f"{indent}[{node['id']}] {node['role']} '{node['name']}'")
        elif node.get('type') == 'text':
            # Aggressive truncation for token efficiency (Anthropic advice)
            text = node['content'][:50].replace('\n', ' ') + ("..." if len(node['content']) > 50 else "")
            lines.append(f"{indent}{text}")
        elif node.get('type') == 'container':
             # Only show container if it has direct text
             if node.get('text'):
                 text = node['text'][:50].replace('\n', ' ') + ("..." if len(node['text']) > 50 else "")
                 lines.append(f"{indent}{text}")
        
        # Recursion
        if 'children' in node:
            for child in node['children']:
                lines.append(self._format_tree(child, depth + 1))
                
        return "\n".join(lines)
